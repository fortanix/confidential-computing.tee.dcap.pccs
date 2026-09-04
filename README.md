# Intel&reg; SGX/TDX Collateral Caching Service (Intel&reg; SGX/TDX CCS)

## Introduction

This repository hosts two primary components:

| Name                 | Source location                    | Description                                                                  |
|----------------------|------------------------------------|------------------------------------------------------------------------------|
| ***CCS Service***   | [`./service`](service)             | Node.js REST service for SGX collateral caching                              |
| ***CCS AdminTool*** | [`./CcsAdminTool`](CcsAdminTool)  | Utilities for managing the cached collateral, manual refresh and inspection  |

Together they support Intel&reg; SGX DCAP remote attestation by locally caching provisioning collateral consumed during quote generation *(PCK certificates, PCK certificate chains)* and verification *(TCB info, CRLs, QE/QvE identities, root CAs, appraisal policies)*, reducing latency and external dependencies.

CCS also caches Intel SGX DCAP provisioning certification collateral (i.e., Platform Manifests), helping centralize the infrastructure set-up as well. For more information, refer to [its README](service/README.md).

For broader DCAP context *(Quote Generation / Verification stacks, QPL, QE/QvE identities)*, see the [DCAP project](https://github.com/intel/SGXDataCenterAttestationPrimitives)
and the [SGX project](https://github.com/intel/linux-sgx).

## License

This project is licensed under the BSD license. See [License.txt](License.txt) for details.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## Instructions

### Install Intel(R) SGX Collateral Caching Service (CCS)

Please follow the instructions in the [service/README.md](service/README.md) to install Intel(R) SGX Collateral Caching Service (CCS).

### Install Administrator tool for CCS

Please follow the instructions in the [CcsAdminTool/README.txt](CcsAdminTool/README.txt) to install Administrator tool for CCS.

## Package downloads (Linux)

Pre-packaged installers of both the **CCS Service** (`sgx-dcap-ccs`) and the **CCS Admin Tool** (`intel-tee-ccs-admin-tool`) are included in the OS distribution-specific package (`sgx_{rpm|deb}_local_repo.tgz`) which can be downloaded from the DCAP download site:

* latest version: https://download.01.org/intel-sgx/latest/dcap-latest/linux/distro/
* specific version: https://download.01.org/intel-sgx/sgx-dcap/

Additionally, for Ubuntu the packages are available in the online repository hosted at https://download.01.org/intel-sgx/sgx_repo/ubuntu/ ([setup instructions](https://cc-enabling.trustedservices.intel.com/intel-tdx-enabling-guide/02/infrastructure_setup/#__tabbed_1_2)).
