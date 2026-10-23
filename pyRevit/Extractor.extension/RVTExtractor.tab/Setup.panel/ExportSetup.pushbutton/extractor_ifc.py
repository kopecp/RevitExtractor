# -*- coding: utf-8 -*-
"""Extractor's legacy IFC map contract; no Revit dependencies."""
from __future__ import unicode_literals

from extractor_config import SetupError

SCHEMA_ID = "DCB88B13-594F-44F6-8F5D-AE9477305AC3"
JSON_SCHEMA_ID = "C2A3E6FE-CE51-4F35-8FF1-20C34567B687"
OWNER_KEY = "RVTExtractorOwner"
OWNER_VALUE = "ExportSetup/2"
SOURCE_KEY = "RVTExtractorSourceJson"

VERSIONS = (
    ("IFC2x3CV2", "IFC 2x3 Coordination View 2.0"),
    ("IFC4RV", "IFC 4 Reference View"),
    ("IFC4DTV", "IFC 4 Design Transfer View"),
)

# Enum values verified against the installed RevitAPI 2026.
VERSION_NAMES = {0: "Default", 8: "IFCBCA", 9: "IFC2x2", 10: "IFC2x3",
                 17: "IFCCOBIE", 21: "IFC2x3CV2", 23: "IFC4", 24: "IFC2x3FM",
                 25: "IFC4RV", 26: "IFC4DTV", 27: "IFC2x3BFM", 29: "IFC4x3", 30: "IFCSG"}
BUILTIN_NAMES = set("IFC " + suffix for suffix in (
    "2x3 Coordination View 2.0", "2x3 Coordination View", "2x3 GSA Concept Design BIM 2010",
    "2x3 Basic FM Handover View", "2x2 Coordination View", "2x2 Singapore BCA e-Plan Check",
    "2x3 Extended FM Handover View"))
BUILTIN_NAMES.update(name.replace("IFC ", "IFC") for name in list(BUILTIN_NAMES))
BUILTIN_NAMES.update(("IFC4 Reference View", "IFC4 Design Transfer View"))

try:
    text = unicode
    string_types = (basestring,)
except NameError:
    text = str
    string_types = (str,)

# Keys are the map keys read by RevitExtractor_Client 2026.7.2.16,
# not the differently named properties serialized by the current Autodesk UI.
FLAGS = (
    ("ExportLinkedFiles", "Eksportuj linki do osobnych plików IFC"),
    ("ExportBaseQuantities", "Ilości bazowe (Base Quantities)"),
    ("ExportIFCCommonPropertySets", "Standardowe zestawy właściwości IFC"),
    ("ExportInternalRevitPropertySets", "Wewnętrzne zestawy właściwości Revit"),
    ("ExportSchedulesAsPsets", "Zestawienia jako zestawy właściwości"),
    ("ExportSpecificSchedules", "Tylko zestawienia oznaczone IFC / Pset / Common"),
    ("SplitWallsAndColumns", "Dziel ściany i słupy według kondygnacji"),
    ("ExportPartsAsBuildingElements", "Eksportuj części jako elementy budynku"),
    ("Export2DElements", "Eksportuj obsługiwane elementy 2D"),
    ("ExportBoundingBox", "Dodaj obwiednię (Bounding Box)"),
    ("ExportSolidModelRep", "Zezwól na reprezentację bryłową (Solid Model)"),
    ("UseFamilyAndTypeNameForReference", "Nazwa rodziny i typu jako Reference"),
    ("Use2DBoundariesForRoomVolume", "Granice 2D do obliczania objętości pomieszczeń"),
    ("IncludeSiteElevation", "Uwzględnij rzędną terenu w lokalnym położeniu terenu"),
)


def defaults():
    """Defaults verified against native CreateDefaultConfiguration()."""
    values = dict((key, False) for key, label in FLAGS)
    values.update(Version="IFC2x3CV2", SpaceBoundaryLevel="0",
                  ExportIFCCommonPropertySets=True)
    return values


def _validate_values(values):
    if set(values) != set(defaults()):
        raise SetupError("Niepełny lub nieznany zestaw ustawień IFC.")
    if values["Version"] not in [key for key, label in VERSIONS]:
        raise SetupError("Wybierz obsługiwaną wersję IFC.")
    if values["SpaceBoundaryLevel"] not in ("0", "1", "2"):
        raise SetupError("Poziom granic pomieszczeń musi wynosić 0, 1 lub 2.")
    for key, label in FLAGS:
        if not isinstance(values[key], bool):
            raise SetupError("Opcja {0} musi mieć wartość tak / nie.".format(key))


def validate_name(name):
    if not isinstance(name, string_types) or not name.strip():
        raise SetupError("Zapisany setup IFC nie ma prawidłowej nazwy.")
    if name in BUILTIN_NAMES:
        raise SetupError("Nazwa {0} koliduje z wbudowanym setupem Extractora. "
                         "Zmień nazwę własnego setupu w oknie Autodesk.".format(name))


def _boolean(value, key):
    if isinstance(value, bool):
        return value
    if isinstance(value, string_types) and value.lower() in ("true", "false"):
        return value.lower() == "true"
    raise SetupError("Nieprawidłowa wartość opcji IFC: {0}.".format(key))


def source_values(record):
    """Project source options into the deliberately small compatibility editor."""
    validate_name(record["name"])
    modern = record["source"] is not None
    source = record["source"] if modern else record["legacy"]
    if not isinstance(source, dict):
        raise SetupError("Brak danych źródłowego setupu IFC.")
    values = defaults()
    notes = []
    consumed = {"Name", "IFCVersion" if modern else "Version",
                "SpaceBoundaries" if modern else "SpaceBoundaryLevel"}
    version = source.get("IFCVersion" if modern else "Version", "IFC2x3CV2")
    version = VERSION_NAMES.get(version, version) if not isinstance(version, (dict, list)) else None
    if version not in [key for key, label in VERSIONS]:
        replacement = "IFC4RV" if version in ("IFC4x3", "IFC4") else "IFC2x3CV2"
        notes.append("Wersja {0} → {1}. Możesz zmienić ją w formularzu.".format(version, replacement))
        version = replacement
    values["Version"] = version
    boundary = text(source.get("SpaceBoundaries" if modern else "SpaceBoundaryLevel", 0))
    if boundary not in ("0", "1", "2"):
        raise SetupError("Nieprawidłowy poziom granic pomieszczeń w setupie.")
    values["SpaceBoundaryLevel"] = boundary
    for key, label in FLAGS:
        source_key = "Use2DRoomBoundaryForVolume" if modern and key == "Use2DBoundariesForRoomVolume" else key
        consumed.add(source_key)
        if source_key not in source or (key == "ExportSpecificSchedules" and source[source_key] is None):
            continue
        value = source[source_key]
        if modern and key == "ExportLinkedFiles":
            modes = {0: False, 1: True, 2: True, 3: True, "DontExport": False,
                     "ExportAsSeparate": True, "ExportSameProject": True, "ExportSameSite": True}
            if isinstance(value, (dict, list)) or value not in modes:
                raise SetupError("Nieznany tryb eksportu linków w setupie.")
            values[key] = modes[value]
            if value in (2, 3, "ExportSameProject", "ExportSameSite"):
                notes.append("Linki w jednym IFC → osobne pliki IFC.")
        else:
            values[key] = _boolean(value, source_key)
    if modern:
        notes.append("Próba zgodności: plik .ifc, bez filtra aktywnego widoku; faza według domyślnych reguł eksportera.")
        omitted = sorted(set(source) - consumed)
        if omitted:
            notes.append("Poza zakresem tej kopii (pozostają w oryginalnym JSON): " + ", ".join(omitted) + ".")
    else:
        notes.append("Starszy zapis Autodesk: pozostałe pola zostaną zachowane.")
    _validate_values(values)
    return values, notes


def build_map(record, values):
    _validate_values(values)
    validate_name(record["name"])
    # Existing legacy setups keep every field not exposed in this editor.
    result = dict(record["legacy"] or {}) if record["source"] is None else {
        OWNER_KEY: OWNER_VALUE, SOURCE_KEY: record["json"],
        "Version": values["Version"], "FileFormat": "Ifc",
        "SpaceBoundaryLevel": values["SpaceBoundaryLevel"], "ActivePhase": "-1",
        "VisibleElementsInCurrentView": "False", "UseActiveViewGeometry": "False",
        "ExportRoomsInView": "False", "StoreIFCGUID": "False",
        "ExportUserDefinedPsets": "False", "ExportUserDefinedPsetsFileName": "",
        "ExportUserDefinedParameterMapping": "False",
        "ExportUserDefinedParameterMappingFileName": "",
    }
    result.update(Name=record["name"], Version=values["Version"],
                  SpaceBoundaryLevel=values["SpaceBoundaryLevel"])
    for key, label in FLAGS:
        result[key] = "True" if values[key] else "False"
    return result


def proposal(record):
    values, notes = source_values(record)
    legacy = record["legacy"]
    if record["source"] is not None and legacy:
        if legacy.get(OWNER_KEY) == OWNER_VALUE and legacy.get(SOURCE_KEY) == record["json"]:
            previous = dict(record, source=None)
            values, unused = source_values(previous)
            notes.insert(0, "Wczytano ostatnio przygotowane ustawienia dla Extractora.")
        else:
            notes.insert(0, "Zapis dla Extractora wymaga ponownego przygotowania z aktualnego źródła.")
    return values, notes


def require_unchanged(expected, current):
    if expected != current:
        raise SetupError("Setup IFC zmienił się od otwarcia okna. Otwórz konfigurator ponownie.")
