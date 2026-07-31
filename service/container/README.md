## 1. Build container image
Replace `DCAP_X.Y` in the following command with the [official release tag](https://github.com/intel/confidential-computing.tee.dcap.ccs/tags) or branch.
When the `DCAP_VERSION` build-arg is not provided, main branch will be used.
``` bash
docker build --build-arg DCAP_VERSION=DCAP_X.Y -t ccs:my_tag .
```

## 2. Generate certificates to use with CCS
``` bash
mkdir -p ~/ccs_tls
cd ~/ccs_tls
openssl genrsa -out private.pem 2048
openssl req -new -key private.pem -out csr.pem
openssl x509 -req -days 365 -in csr.pem -signkey private.pem -out file.crt
rm -rf csr.pem
```
and give read access to the certificate/key in order they're to be readable inside container by user other than host files owner:
``` bash
chmod 644 ~/ccs_tls/*
```

## 3. Fill up configuration file
Create directory for storing configuration file:
``` bash
mkdir -p ~/config
```
Copy `<path_to_repo>/service/config/default.json`
to this directory:
``` bash
cp <path_to_repo>/service/config/default.json ~/config/
```
Generate UserTokenHash:
``` bash
echo -n "user_password" | sha512sum | tr -d '[:space:]-'
```
and AdminTokenHash:
``` bash
echo -n "admin_password" | sha512sum | tr -d '[:space:]-'
```
and paste generated values into the `~/config/default.json`

Fill other required fields accordingly.

For example, if intending to use the built-in SQLite DB for testing ( `"DB_CONFIG": "sqlite"` ), make sure to edit the `sqlite.options.storage` option to match your setup, and mount the file into persistent storage.
For example:  for `"storage": "/data/pckcache.db"` make sure to mount `/data` as a volume (e.g. by adding `-v $PWD/data:/data` to the docker run command below and ensuring that `$PWD/data` directory exists and container has permissions to write to it e.g. by running `mkdir $PWD/data && sudo chown :70636373 $PWD/data && chmod g+w $PWD/data` - `70636373` is default ID for group `ccs`).

## 4. Run container
Replace `my_tag` with the tag of Docker image you built in point 1.
``` bash
cd && \
docker run \
--user "ccs:ccs" \
-v $PWD/ccs_tls/private.pem:/opt/intel/ccs/ssl_key/private.pem \
-v $PWD/ccs_tls/file.crt:/opt/intel/ccs/ssl_key/file.crt \
-v $PWD/config/default.json:/opt/intel/ccs/config/default.json \
-p 8081:8081 --name ccs -d ccs:my_tag
```

## 5. Check if ccs service is running and available:
``` bash
docker logs -f ccs
```

Output:

``` bash
2025-10-08 07:04:15.170 [info]: DB Migration (Ver.0 -> 1) -- Start
2025-10-08 07:04:15.186 [info]: DB Migration -- Done.
2025-10-08 07:04:15.217 [info]: DB Migration (Ver.1 -> 2) -- Start
2025-10-08 07:04:15.229 [info]: DB Migration -- Done.
2025-10-08 07:04:15.257 [info]: DB Migration (Ver.2 -> 3) -- Start
2025-10-08 07:04:15.267 [info]: DB Migration -- Done.
2025-10-08 07:04:15.296 [info]: DB Migration (Ver.3 -> 4) -- Start
2025-10-08 07:04:15.299 [info]: DB Migration -- Done.
2025-10-08 07:04:15.327 [info]: DB Migration (Ver.4 -> 5) -- Start
2025-10-08 07:04:15.338 [info]: DB Migration -- Done.
2025-10-08 07:04:15.527 [info]: HTTPS Server is running on: https://localhost:8081
```

Execute command:
``` bash
curl -kv https://localhost:8081
```
to check if ccs service is available.

## 6. Stop container:
``` bash
docker stop ccs
```

