#!/usr/bin/env bash
# Genera la clave privada y el pedido de certificado (CSR) para los web services de ARCA.
# Uso (Mac/Linux):  bash scripts/generar-csr.sh 20123456789 "Nombre Apellido" homologacion
#
# Deja en ~/arca-certs/<entorno>/:
#   arca.key  → clave privada. NO la compartas ni la subas a ningún lado salvo a Vercel.
#   arca.csr  → esto es lo que pegás en ARCA (WSASS en homologación, "Administración de Certificados Digitales" en producción).
set -euo pipefail

CUIT="${1:?Falta el CUIT (solo números)}"
NOMBRE="${2:?Falta el nombre o razón social entre comillas}"
ENTORNO="${3:-homologacion}"
ALIAS="arcafacturador${ENTORNO:0:4}"

DIR="$HOME/arca-certs/$ENTORNO"
mkdir -p "$DIR"
chmod 700 "$DIR"

if [ -f "$DIR/arca.key" ]; then
  echo "Ya existe $DIR/arca.key — no lo piso. Borralo a mano si querés generar uno nuevo." >&2
  exit 1
fi

openssl genrsa -out "$DIR/arca.key" 2048
chmod 600 "$DIR/arca.key"
openssl req -new -key "$DIR/arca.key" \
  -subj "/C=AR/O=$NOMBRE/CN=$ALIAS/serialNumber=CUIT $CUIT" \
  -out "$DIR/arca.csr"

echo
echo "Listo. Archivos en $DIR"
echo "Copiá este CSR y pegalo en ARCA:"
echo
cat "$DIR/arca.csr"
