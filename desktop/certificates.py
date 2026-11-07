"""Frozen-backend startup: use portable trusted roots without changing system trust."""
import os
from pathlib import Path
import ssl
import sys

if not os.environ.get('SSL_CERT_FILE') and not os.environ.get('SSL_CERT_DIR'):
    bundle = Path(sys._MEIPASS) / 'certificates' / 'cacert.pem'
    if not bundle.is_file() or not ssl.create_default_context(cafile=str(bundle)).get_ca_certs():
        raise RuntimeError('The bundled HTTPS certificate roots are missing. Reinstall Scene Director.')
    os.environ['SSL_CERT_FILE'] = str(bundle)
