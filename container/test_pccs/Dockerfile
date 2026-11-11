# This Dockerfile use rust image to run dcap-artifact-retrieval PCCS
# unit tests which targeting PCCS running at ${PCCS_URL}

FROM rust:1.85.1-slim-bookworm

RUN apt-get update && \
    apt-get install -y git libssl-dev pkg-config cmake libclang-dev curl jq && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /rust-sgx

# This is modified dcap-artifact-retrieval which could load PCCS url from env.
RUN git init && \
    git remote add origin https://github.com/fortanix/rust-sgx.git && \
    git fetch origin 2d035c3cc98d45ada210d071ac64c750ac3d305d && \
    git checkout FETCH_HEAD


RUN cargo build --locked --tests -p dcap-artifact-retrieval


COPY test.sh /rust-sgx/test.sh

CMD ["/rust-sgx/test.sh"]
