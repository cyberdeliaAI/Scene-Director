"""Locate redistribution notices in the native build environment."""
import importlib.metadata as metadata
import json
from pathlib import Path
import sys
import sysconfig


def distribution_license(name, suffix):
    package = metadata.distribution(name)
    return str(next(package.locate_file(f) for f in package.files if str(f).endswith(suffix)))


python_license = next((p for p in [Path(sysconfig.get_path('stdlib'))/'LICENSE.txt',
                                    Path(sys.base_prefix)/'LICENSE.txt'] if p.is_file()), None)
if python_license is None:
    raise RuntimeError('The native Python redistribution license is missing.')
licenses = {'Python-LICENSE.txt':str(python_license),
            'PyInstaller-COPYING.txt':distribution_license('pyinstaller', 'licenses/COPYING.txt'),
            'certifi-LICENSE.txt':distribution_license('certifi', 'licenses/LICENSE')}
third_party = Path(sys.base_prefix)/'Resources/English.lproj/Documentation/license.html'
if third_party.is_file():
    licenses['Python-third-party-licenses.html'] = str(third_party)
print(json.dumps(licenses))
