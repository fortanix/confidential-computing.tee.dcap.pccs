# Collateral Caching Service (CCS)

# Table of Contents

- [Introduction](#introduction)
- [How to install](#how-to-install)
    - [Prerequisites](#prerequisites)
    - [Install via Linux Debian package installer](#install-via-linux-debian-package-installer)
    - [Install via RPM package installer](#install-via-rpm-package-installer)
    - [Linux manual installation](#linux-manual-installation)
    - [Windows manual installation](#windows-manual-installation)
- [Configuration file (`config/default.json`)](#configuration-file-configdefaultjson)
- [Caching Fill Mode](#caching-fill-mode)
    - [LAZY mode](#lazy-mode)
    - [REQ mode](#req-mode)
    - [OFFLINE mode](#offline-mode)
- [Local service vs. Remote service](#local-service-vs-remote-service)
- [Manage the CCS service](#manage-the-ccs-service)
- [Uninstall](#uninstall)
- [Further reading](#further-reading)

## Introduction

This is a lightweight Collateral Caching Service implemented in Node.js for reference.
It retrieves PCK Certificates and other collaterals on-demand using the internet at runtime, and then caches them in local database.
The CCS exposes similar HTTPS interfaces as [Intel® SGX and Intel® TDX Provisioning Certification Service](https://api.portal.trustedservices.intel.com/content/documentation.html#pcs).

## How to install

> [!NOTE]
> You may also want to refer to our [enabling documentation](https://cc-enabling.trustedservices.intel.com/intel-tdx-enabling-guide/02/infrastructure_setup/#provisioning-certificate-caching-service-ccs) for a streamlined installation instruction.

### Prerequisites

Install Node.js (in Active LTS or Maintenance LTS status according to the official [Node.js release schedule](https://nodejs.org/en/about/previous-releases)) from official repositories of your Linux distribution (if they provide Node.js v22.13.0 or later), [NodeSource](https://nodesource.com/products/distributions) or [official Node.js site](https://nodejs.org/en/download).

Make sure `node --version` reports version v22.13.0 or higher.

> [!NOTE]
> Node.js v18 and v20, which are End-of-Life (EOL), are no longer supported.

> [!NOTE]
> Files created by the running service may remain even after you uninstall it using package manager.
> You can delete them manually with root privilege.

### Install via Linux Debian package installer

#### Using interactive installer

In interactive mode, you will be prompted for configuration settings during the installation process.

Install from package repository or DEB file

  ``` bash
  # If you have the package repository set-up
  sudo apt install sgx-dcap-ccs

  # Alternatively, if you have built from source or downloaded the package manually
  sudo apt install ./sgx-dcap-ccs*.deb
  ```

If you cancelled installation in interactive mode, the package remains half-configured. Run `sudo dpkg --configure sgx-dcap-ccs` to re-trigger the configuration process.

To start the service and check its status, see section [Manage the CCS service](#manage-the-ccs-service)

#### In non-interactive mode

If you would like to bypass the prompts and configure the CCS at a later stage, make sure to set `DEBIAN_FRONTEND=noninteractive` before invoking `apt`.

Install from package repository or DEB file

  ``` bash
  # If you have the package repository set-up
   sudo env DEBIAN_FRONTEND=noninteractive apt install sgx-dcap-ccs

  # Alternatively, if you have built from source or downloaded the package manually
   sudo env DEBIAN_FRONTEND=noninteractive apt install ./sgx-dcap-ccs*.deb
  ```

You'll need to then call `sudo -u ccs /opt/intel/sgx-dcap-ccs/install.sh` manually to finish up the interactive configuration, or manually edit the relevant configuration files.

To start the service and check its status, see section [Manage the CCS service](#manage-the-ccs-service)

### Install via RPM package installer

1. Install from package repository or RPM file
   ``` bash
   # If you have the package repository set-up
   sudo dnf install sgx-dcap-ccs
   
   # Alternatively, if you have built from source or downloaded the package manually
   sudo dnf install ./sgx-dcap-ccs*.rpm
   ```

2. After the RPM package was installed, go to the root directory of the CCS (`/opt/intel/sgx-dcap-ccs/`) and run `install.sh` with account `ccs`:
   ``` bash
   cd /opt/intel/sgx-dcap-ccs/
   sudo -u ccs ./install.sh
   ```

3. To start the service and check its status, see section [Manage the CCS service](#manage-the-ccs-service)

### Linux manual installation

1. Put all the files and sub folders in this directory to your preferred place with right permissions set to launch a web service.
2. Install dependencies if they are not already installed.  
   ```
   sudo apt install nodejs cracklib-runtime
   ```

3. From the root directory of your installation folder, run `./install.sh`.
4. If you want to run CCS as a system service, run `sudo ./startup.sh`
5. To start the service and check its status, see section [Manage the CCS service](#manage-the-ccs-service)

> [!NOTE]
> The `install.sh` script can generate certificates for development purposes. It creates a dedicated, self-signed CA certificate (`ssl_key/ca.crt`) and a server leaf certificate (`ssl_key/file.crt`) signed by that CA. The CA certificate can be used with [CCS Admin Tool](../CcsAdminTool) via the `--ca ssl_key/ca.crt` option, or by adding `ssl_key/ca.crt` to the trusted CA store used by the client/runtime.
>
> If this certificate isn't added to the system's trusted CAs, you need to set `"use_secure_cert": false` when configuring the default QPL library (see [QPL README](https://github.com/intel/SGXDataCenterAttestationPrimitives/blob/main/QuoteGeneration/qpl/README.md)). If the certificate is not provided to [CCS Admin Tool](../CcsAdminTool) with `--ca` and is not trusted by the Admin Tool's default CA bundle, use `--no-ccs-cert-check` instead.
>
> As an alternative to passing `--ca` on every Admin Tool command, you can set the `REQUESTS_CA_BUNDLE` environment variable to a CA certificate bundle file or directory. `CURL_CA_BUNDLE` is also honoured as a fallback.

### Windows manual installation

1. Put all the files and sub folders in this directory to your preferred place with right permissions set to launch a web service.
2. (Optional) If the target machine connects to internet through a proxy server, configure proxy server first
   before continuing. 
   ``` batch
   npm config set http-proxy http://your-proxy-server:port
   npm config set https-proxy http://your-proxy-server:port
   npm config set proxy http://your-proxy-server:port
   ```

3. Update config file based on your environment, see section [Configuration file](#configuration-file-configdefaultjson).

4. Private key and public certificate

   The CCS requires a private key and certificate pair to run as HTTPS server.
   For production environment you should use formally issued key and certificate.
   Please put the key files in `ssl_key` subdirectory.

   You can also generate an insecure key and certificate pair with following commands (only for debug purpose):

   ``` batch
   if not exist ssl_key mkdir ssl_key
   cd ssl_key
   openssl genrsa -out private.pem 2048
   openssl req -new -key private.pem -out csr.pem
   openssl x509 -req -days 365 -in csr.pem -signkey private.pem -out file.crt
   cd ..
   ```

5. From the root directory of your installation folder, run `install.bat`.
6. If you want to run CCS as a system service, run `startup.bat` with administrator privilege.
7. To start the service and check its status, see section [Manage the CCS service](#manage-the-ccs-service)

> [!NOTE]
> If a self-signed insecure key and certificate are used for CCS, you need to set `"use_secure_cert": false` when configuring the default QPL library (see [QPL README](https://github.com/intel/SGXDataCenterAttestationPrimitives/blob/main/QuoteGeneration/qpl/README.md)).
> Additionally, the TLS certificate verification done by the [CCS Admin Tool](../CcsAdminTool) will fail, because the tool uses the Python module `Requests`, which does not trust this self-signed certificate.
> Optionally, use `--no-ccs-cert-check` to skip TLS certificate verification in this case.

## Configuration file *([`config/default.json`](./config/default.json))*

- **`HTTPS_PORT`** - The port you want the CCS to listen on. The default listening port is `8081`.
- **`hosts`** - The hosts that will be accepted for connections. Default is localhost only. To accept all connections use `0.0.0.0`
- **`uri`** - The URL of Intel Provisioning Certificate Service. The default URL is `https://api.trustedservices.intel.com/sgx/certification/v4/`
- **`ApiKey`** - The CCS uses this API key to request collaterals from Intel® SGX and Intel® TDX Provisioning Certification Service (Intel PCS).  
  User needs to subscribe first to obtain an API key.  
  For how to subscribe to Intel PCS and receive an API key, goto https://api.portal.trustedservices.intel.com/provisioning-certification and click on [_Subscribe_](https://api.portal.trustedservices.intel.com/products#product=liv-intel-software-guard-extensions-provisioning-certification-service).
- **`proxy`** - Specify the proxy server for internet connection, for example, `"http://192.168.1.1:80"`. Leave blank for no proxy or system proxy.
- **`RefreshSchedule`** - cron-style refresh schedule for the CCS to refresh cached artifacts including CRL/TCB Info/QE Identity/QVE Identity.
  The default setting is `"0 0 1 * * *"`, which means refresh at 1:00 AM every day.
- **`UserTokenHash`** - Sha512 hash of the user token for the CCS client user to register a platform. For example, PCK Cert ID retrieval tool will use the user token to send platform information to the CCS.
- **`AdminTokenHash`** - Sha512 hash of the administrator token for the CCS administrator to perform a manual refresh of cached artifacts.
- **`MaxRequestBodySize`** - Maximum allowed size of the request body. 2MB by default. You can use KB, MB, GB.
- **`HeadersTimeoutSeconds`** - Maximum time in seconds to wait for the client to send complete HTTP headers. Default value is 10.
- **`RequestTimeoutSeconds`** - Maximum time in seconds to wait for the client to send the entire request (headers + body). Default value is 15.
- **`KeepAliveTimeoutSeconds`** - Maximum idle time in seconds on a keep-alive connection before it is closed. Default value is 60.


> [!NOTE]
> For Windows you need to set the UserTokenHash and AdminTokenHash manually. For example, you can calculate SHA512 hash using the following PowerShell snippet:

  ``` powershell
  [BitConverter]::ToString(
    [System.Security.Cryptography.SHA512]::Create().ComputeHash(
        [System.Text.Encoding]::UTF8.GetBytes((Read-Host "Type the secret token (password) to hash"))
    )
  ).Replace('-', '').ToLower()
  ```

- **`CachingFillMode`** - The method used to fill the cache DB. Can be one of the following: `LAZY`/`REQ`/`OFFLINE`. For more details see the section [Caching Fill Mode](#caching-fill-mode).
- **`LogLevel`** - Log level. Use the same levels as npm: `error`, `warn`, `info`, `http`, `verbose`, `debug`, `silly`. Default is `info`.
- **`DB_CONFIG`** - You can choose `sqlite` or `mysql` and many other DBMSes. For `sqlite`, you don't need to change anything. For other DBMSes, you need to set database connection options correctly. Normally you need to change database, username, password, host and dialect to connect to your DBMS.  
> [!NOTE]
> It's recommended to delete the cache database first if you have installed a version older than 1.9 because the database is not compatible.

## Caching Fill Mode

When a new server platform is introduced to the data center or the cloud service provider that will require SGX remote attestation, the caching service will need to import the platform’s SGX attestation collateral retrieved from Intel.
This collateral will be used for both generating and verifying ECDSA quotes.
Currently, the CCS supports three caching fill methods:

### `LAZY` mode
In this method of filling the cache, when the CCS gets a retrieval request (PCK Cert, TCB etc.) at runtime, it looks for the collaterals in its database to see if they are already in the cache.  
If they do not exist, it will contact the Intel PCS to retrieve the collaterals.  
> [!NOTE]
> This mode only works when internet connection is available.

### `REQ` mode
In this method of filling the cache, the CCS creates a platform database entry when the CCS receives the platform registration requests during platform deployment/provisioning.  
The CCS does not return any data to the caller but contacts the Intel PCS to retrieve the platform's collaterals if they are not in its cache.  
The CCS saves the retrieved collateral in cache database for use during runtime.  
> [!NOTE]
> This mode requires the CCS to have an Internet connection at deployment/provisioning time.  
> During runtime, the CCS uses cache data only and does not contact Intel PCS.

### `OFFLINE` mode
In this method of filling the cache, the CCS creates a platform database entry to save platform registration information sent by the [PCK Cert ID retrieval tool](https://github.com/intel/SGXDataCenterAttestationPrimitives/tree/main/tools/PCKRetrievalTool).  
Later, [CCS Admin Tool](../CcsAdminTool) can be used on a CCS-connected host in order to get and save the pending registration request to a JSON file.  
The file can be then manually transferred to an Internet-connected host with the [PCS Client Tool](https://github.com/intel/SgxDataCenterAttestationPrimitives/tree/main/tools/PcsClientTool) installed. PCS Client tool can fetch the platform collaterals from Intel PCS and save the result to an output file.  
The file with the collaterals can be then transferred back to a CCS-connected host and [CCS Admin Tool](../CcsAdminTool) can be used to upload them to the CCS.  
> [!NOTE]
> In this mode the CCS does not have access to the Intel PCS on the Internet.

## Local service vs. Remote service

You can run the CCS on `localhost` for product development or setup it as a public remote service in datacenter.
Typical setup flow for **Local** Service mode (Ubuntu 22.04 as example):

1. Install Node.js (in Active LTS or Maintenance LTS status according to the official [Node.js release schedule](https://nodejs.org/en/about/previous-releases)) from official repositories of your Linux distribution (if they provide Node.js v22.13.0 or later), [NodeSource](https://nodesource.com/products/distributions) or [official Node.js site](https://nodejs.org/en/download).
2. Request an API key from Intel's Provisioning Certificate Service.
3. Install the CCS through Debian package.

You can test the CCS by running QuoteGeneration sample:

1. Set `"use_secure_cert": false` in `/etc/sgx_default_qcnl.conf`.
2. Build and run [QuoteGeneration sample](https://github.com/intel/SGXDataCenterAttestationPrimitives/tree/main/SampleCode/QuoteGenerationSample) and verify `CertType=5` quote is generated.

For **Remote** service mode, you must use a formal key and certificate pair. The certificate must meet the following requirements:
- The Certificate Authority (CA) certificate must have the `basicConstraints` extension with `CA:TRUE` and `keyUsage` extension with `keyCertSign`.
- The leaf (server) certificate must have a Subject Alternative Name (SAN) matching the server address and `keyUsage` extension with `digitalSignature`.
- The CA chain must be trusted by the clients connecting to the CCS. For the QPL library, set `"use_secure_cert": true` in `/etc/sgx_default_qcnl.conf` (For Windows see the OS-specific note of [QPL README](https://github.com/intel/SGXDataCenterAttestationPrimitives/tree/main/QuoteGeneration/qpl#configuration)). For the [CCS Admin Tool](../CcsAdminTool), the CA chain must either be trusted by the CA bundle used by Python Requests on that system, or provided using the `--ca` option.

You should also change `'hosts'` to `0.0.0.0` to accept remote connections. Also make sure the firewall is not blocking your listening port.

## Manage the CCS service

- If the CCS was installed as a system service using Debian or RPM package

1. Check status:
   ```bash
   sudo systemctl status ccs
   ```

2. Start/Stop/Restart CCS:
   ``` bash
   sudo systemctl start ccs
   sudo systemctl stop ccs
   sudo systemctl restart ccs
   ```

3. Check ccs service logs:
   ```bash
   sudo journalctl -u ccs
   ```

- If the CCS was installed as Windows service

1. Check `Intel(R) Collateral Caching Service` status in Task Manager (Services tab) or in the Services management console (services.msc).
2. Start/Stop the service from Task Manager (Services tab) or Services management console (services.msc)
   or use the following commands in an administrator command prompt:
   ``` batch
   net start "Intel(R) Collateral Caching Service"
   net stop "Intel(R) Collateral Caching Service"
   ```
3. Read application logs stored in `*.log` files in `daemon/` folder in service installation directory
4. Service events can be found in Events Viewer in `Windows Logs` -> `Application` section by source `Intel(R) Collateral Caching Service`

- If the CCS was installed manually by current user, you can start it with the following command:
  ``` bash
  NODE_ENV=production node ccs_server.js
  ```
  or simply
  ```bash
  npm start
  ```
  executed inside installation directory.

  CCS installed this way won't start automatically after machine restart. You need to start it manually after each reboot.

  Application logs are stored in `./logs/ccs_server.log` inside installation directory.

## Uninstall

* If the CCS service was installed through Debian/RPM package, you can use Linux package manager to uninstall it.
* If the CCS service was installed manually, you can run below script to uninstall it:
    * On Linux
      ```bash
      ./uninstall.sh
      ```
    * On Windows (run with administrator privilege)
      ```batch
      uninstall.bat 
      ```

## Further reading

1. The CCS Design Guide is available at https://cc-enabling.trustedservices.intel.com/intel-sgx-tdx-ccs.
2. There's a `Dockerfile` available for running the CCS as a container. See the [README](container/README.md) in `container` subdirectory.
