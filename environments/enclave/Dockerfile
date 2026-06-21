# Reproducible-ish image for the Polius attestation enclave.
# Build for the enclave host arch (Oyster Nitro = arm64): docker build --platform linux/arm64 .
FROM python:3.14-alpine AS builder
RUN apk add --no-cache gcc musl-dev libffi-dev
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

FROM python:3.14-alpine
RUN apk add --no-cache libgcc libffi
WORKDIR /app/demo
COPY --from=builder /install /usr/local
COPY server.py ./server.py
RUN chmod +x server.py
ENTRYPOINT ["python3", "server.py"]
# The enclave's secp256k1 key is provided/sealed by the TEE at this path.
CMD ["/app/ecdsa.sec"]
