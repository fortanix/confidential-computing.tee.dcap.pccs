#!/usr/bin/env python3
# Copyright (c) Fortanix, Inc. SPDX-License-Identifier: BSD-3-Clause
"""Build the production PCCS image from a published Git ref.

The upstream Dockerfile clones its source during `docker build`, so this
script refuses local edits: the selected branch or tag must already resolve
to checkout HEAD. The intermediate builder image is always removed. The
final image is removed unless `--keep-image` was given and the build
succeeded.
"""

from __future__ import annotations

import json
import os
import random
import re
import signal
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
USAGE = """\
Usage: ./container/pccs/build.py [options]
  --release             Use <version>-<sha> instead of <version>-dev-<sha>
  --publish REPOSITORY  Explicitly push to this image repository
  --keep-image          Retain the final local image after a successful build
  --source URL          Clone URL (default: origin)
  --ref BRANCH_OR_TAG    Published ref (default: current branch)
  --node-version VER    Node.js version to build (default: 24.22.1)
  --help                Show this help
The published ref must resolve to checkout HEAD. Local edits are not built.
"""
WHITESPACE = re.compile(r"[ \t\n\v\f\r]")


class BuildFailure(Exception):
    def __init__(self, code: int):
        self.code = code


@dataclass
class Options:
    release: bool = False
    keep: bool = False
    publish: str = ""
    source_url: str = ""
    selected_ref: str = ""
    node_version: str = "24.22.1"


@dataclass
class BuildState:
    probe: str
    builder: str
    image: str
    keep: bool
    final_built: bool = False
    success: bool = False
    proc: subprocess.Popen[str] | None = None


def die(message: str) -> None:
    print(f"Error: {message}", file=sys.stderr)
    raise BuildFailure(1)


def command_output(args: list[str]) -> str:
    completed = subprocess.run(
        args,
        stdout=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        check=False,
    )
    if completed.returncode != 0:
        raise BuildFailure(completed.returncode)
    return completed.stdout.rstrip("\n")


def run(state: BuildState, args: list[str], *, capture: bool = False) -> subprocess.CompletedProcess[str]:
    proc = subprocess.Popen(
        args,
        stdout=subprocess.PIPE if capture else None,
        text=True,
        encoding="utf-8",
    )
    state.proc = proc
    try:
        stdout, _ = proc.communicate()
    except BaseException:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
        raise
    finally:
        state.proc = None
    if proc.returncode != 0:
        code = proc.returncode
        if code < 0:
            code = 128 + (-code)
        raise BuildFailure(code)
    return subprocess.CompletedProcess(args, proc.returncode, stdout)


def quiet(args: list[str]) -> None:
    try:
        subprocess.run(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
    except OSError:
        pass


def parse_args(argv: list[str]) -> Options:
    options = Options()
    index = 0
    while index < len(argv):
        arg = argv[index]
        if arg == "--help":
            sys.stdout.write(USAGE)
            raise SystemExit(0)
        if arg == "--release":
            options.release = True
            index += 1
            continue
        if arg == "--keep-image":
            options.keep = True
            index += 1
            continue
        if arg in {"--source", "--ref", "--publish", "--node-version"}:
            if index + 1 >= len(argv) or argv[index + 1] == "" or argv[index + 1].startswith("--"):
                die(f"{arg} requires an argument")
            value = argv[index + 1]
            if arg == "--source":
                options.source_url = value
            elif arg == "--ref":
                options.selected_ref = value
            elif arg == "--node-version":
                options.node_version = value
            else:
                options.publish = value
            index += 2
            continue
        die(f"Unknown option: {arg}")
    return options


def single_shell_word(value: str) -> bool:
    return not value.startswith("-") and WHITESPACE.search(value) is None


def select_remote_sha(remote_refs: str, selected_ref: str) -> str:
    """Match the shell script's awk filters, preferring a peeled tag."""
    found = {
        f"refs/heads/{selected_ref}": [],
        f"refs/tags/{selected_ref}": [],
        f"refs/tags/{selected_ref}^{{}}": [],
    }
    for line in remote_refs.splitlines():
        parts = line.split()
        if len(parts) >= 2 and parts[1] in found:
            found[parts[1]].append(parts[0])

    def joined(ref: str) -> str:
        return "\n".join(found[ref])

    branch_sha = joined(f"refs/heads/{selected_ref}")
    tag_sha = joined(f"refs/tags/{selected_ref}^{{}}") or joined(f"refs/tags/{selected_ref}")
    if branch_sha and tag_sha and branch_sha != tag_sha:
        die("Ambiguous branch and tag")
    return branch_sha or tag_sha


def read_version() -> str:
    try:
        version = json.loads(Path("service/package.json").read_text(encoding="utf-8"))["version"]
    except (OSError, json.JSONDecodeError, KeyError, TypeError) as exc:
        die(f"Cannot read service version: {exc}")
    if not isinstance(version, str) or not version:
        die("Invalid service version")
    return version


def runtime_user_name(runtime_user: str) -> str:
    return runtime_user.split(":", 1)[0]


def build_manifest(inspection: dict, image: str, revision: str, version: str, source: str, ref: str) -> dict:
    digests = inspection.get("RepoDigests")
    if digests is None:
        digests = []
    return {
        "image": image,
        "revision": revision,
        "version": version,
        "source": source,
        "ref": ref,
        "imageId": inspection["Id"],
        "runtimeUser": inspection["Config"]["User"],
        "registryDigests": digests,
    }


def cleanup(state: BuildState) -> None:
    quiet(["docker", "rm", "-f", state.probe])
    quiet(["docker", "image", "rm", state.builder])
    if state.final_built and (not state.keep or not state.success):
        quiet(["docker", "image", "rm", state.image])


def resolve_source(options: Options) -> tuple[str, str, str, str]:
    head_sha = command_output(["git", "rev-parse", "HEAD"])
    short_sha = command_output(["git", "rev-parse", "--short", "HEAD"])
    source_url = options.source_url or command_output(["git", "remote", "get-url", "origin"])
    selected_ref = options.selected_ref
    if not selected_ref:
        completed = subprocess.run(
            ["git", "symbolic-ref", "--quiet", "--short", "HEAD"],
            stdout=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            check=False,
        )
        if completed.returncode != 0:
            die("Detached checkout requires --ref")
        selected_ref = completed.stdout.rstrip("\n")
    if not single_shell_word(source_url):
        die("Invalid source URL")
    if not single_shell_word(selected_ref):
        die("Invalid ref")
    if not single_shell_word(options.node_version):
        die("Invalid node version")
    check = subprocess.run(
        ["git", "check-ref-format", f"refs/heads/{selected_ref}"],
        stdout=subprocess.DEVNULL,
        check=False,
    )
    if check.returncode != 0:
        die("Invalid ref")
    remote = subprocess.run(
        [
            "git",
            "ls-remote",
            "--exit-code",
            source_url,
            f"refs/heads/{selected_ref}",
            f"refs/tags/{selected_ref}",
            f"refs/tags/{selected_ref}^{{}}",
        ],
        stdout=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        check=False,
    )
    if remote.returncode != 0:
        die("Ref is unpublished or source is inaccessible")
    remote_sha = select_remote_sha(remote.stdout, selected_ref)
    if remote_sha != head_sha:
        die(f"Published ref resolves to {remote_sha}; checkout is {head_sha}")
    return source_url, selected_ref, head_sha, short_sha


def docker_build(
    state: BuildState,
    source_url: str,
    selected_ref: str,
    head_sha: str,
    version: str,
    publish: str,
    node_version: str,
) -> None:
    build_args = [
        "--file",
        "service/container/Dockerfile",
        "--build-arg",
        f"NODE_VERSION={node_version}",
        "--build-arg",
        f"SRC_LOCATION={source_url}",
        "--build-arg",
        f"DCAP_VERSION={selected_ref}",
        "--build-arg",
        (
            "CLONE_FLAGS=--branch "
            f"{selected_ref} --single-branch --depth 1 --config pccs.build-revision={head_sha}"
        ),
        "--label",
        f"org.opencontainers.image.revision={head_sha}",
        "--label",
        f"org.opencontainers.image.version={version}",
        "--label",
        f"org.opencontainers.image.source={source_url}",
    ]
    print(f"Building {state.image} from {source_url} ({selected_ref} at {head_sha})", flush=True)
    run(state, ["docker", "build", *build_args, "--target", "builder", "--tag", state.builder, "service/container"])
    cloned = run(
        state,
        [
            "docker",
            "run",
            "--rm",
            "--name",
            state.probe,
            "--entrypoint",
            "git",
            state.builder,
            "-C",
            "/pccs",
            "rev-parse",
            "HEAD",
        ],
        capture=True,
    )
    cloned_sha = (cloned.stdout or "").rstrip("\n")
    if cloned_sha != head_sha:
        die(f"Cloned revision mismatch: {cloned_sha}")
    run(state, ["docker", "build", *build_args, "--tag", state.image, "service/container"])
    state.final_built = True
    inspected_user = run(
        state,
        ["docker", "image", "inspect", "--format", "{{.Config.User}}", state.image],
        capture=True,
    )
    if runtime_user_name((inspected_user.stdout or "").rstrip("\n")) in {"", "root", "0"}:
        die("Final image must run as a non-root user")
    if publish:
        run(state, ["docker", "push", state.image])


def write_reports(state: BuildState, head_sha: str, version: str, source_url: str, selected_ref: str) -> None:
    report_dir = Path("service/test-reports")
    report_dir.mkdir(parents=True, exist_ok=True)
    inspected = run(state, ["docker", "image", "inspect", state.image], capture=True)
    (report_dir / "image-inspect.json").write_bytes((inspected.stdout or "").encode())
    inspection = json.loads(inspected.stdout or "")[0]
    manifest = build_manifest(inspection, state.image, head_sha, version, source_url, selected_ref)
    text = json.dumps(manifest, indent=2) + "\n"
    (report_dir / "image-manifest.json").write_text(text, encoding="utf-8")
    sys.stdout.write(text)


def build(options: Options) -> None:
    os.chdir(REPO_ROOT)
    source_url, selected_ref, head_sha, short_sha = resolve_source(options)
    version = read_version()
    suffix = f"-{short_sha}" if options.release else f"-dev-{short_sha}"
    image = f"{options.publish or 'pccs'}:{version}{suffix}"
    state = BuildState(
        probe="",
        builder=f"pccs-builder-{os.getpid()}-{random.randint(0, 32767)}",
        image=image,
        keep=options.keep,
    )
    state.probe = f"{state.builder}-probe"

    def stop_child(signum: int, _frame) -> None:
        proc = state.proc
        if proc is not None and proc.poll() is None:
            proc.terminate()
        if signum == signal.SIGINT:
            raise KeyboardInterrupt
        raise BuildFailure(143)

    signal.signal(signal.SIGINT, stop_child)
    signal.signal(signal.SIGTERM, stop_child)
    try:
        docker_build(state, source_url, selected_ref, head_sha, version, options.publish, options.node_version)
        write_reports(state, head_sha, version, source_url, selected_ref)
        state.success = True
    finally:
        signal.signal(signal.SIGINT, signal.SIG_IGN)
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        cleanup(state)


def main(argv: list[str] | None = None) -> int:
    try:
        options = parse_args(sys.argv[1:] if argv is None else argv)
        build(options)
    except BuildFailure as exc:
        return exc.code
    except KeyboardInterrupt:
        return 130
    except SystemExit as exc:
        if exc.code is None or exc.code == 0:
            return 0
        return exc.code if isinstance(exc.code, int) else 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
