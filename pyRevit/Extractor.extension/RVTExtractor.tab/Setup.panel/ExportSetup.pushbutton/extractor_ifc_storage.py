# -*- coding: utf-8 -*-
"""Add/update Autodesk's legacy entity on a selected existing IFC DataStorage."""
from __future__ import unicode_literals

import json
from System import Guid, String
from System.Collections.Generic import Dictionary, IDictionary, List
from pyrevit import DB
from Autodesk.Revit.DB.ExtensibleStorage import (
    Schema, SchemaBuilder, Entity, DataStorage, ContainerType, AccessLevel)

from extractor_config import SetupError
from extractor_ifc import (
    SCHEMA_ID, JSON_SCHEMA_ID, BUILTIN_NAMES, VERSION_NAMES, FLAGS,
    build_map, require_unchanged)

try:
    text = unicode
except NameError:
    text = str


def _map_schema():
    schema = Schema.Lookup(Guid(SCHEMA_ID))
    if schema is not None:
        field = schema.GetField("MapField")
        if (schema.SchemaName != "IFCExportConfigurationMap" or field is None
                or field.ContainerType != ContainerType.Map
                or field.KeyType.FullName != "System.String"
                or field.ValueType.FullName != "System.String"
                or schema.ReadAccessLevel != AccessLevel.Public
                or schema.WriteAccessLevel != AccessLevel.Public
                or len(list(schema.ListFields())) != 1):
            raise SetupError("Niezgodna definicja schematu IFC. Model nie zostanie zmieniony.")
    return schema


def _validate_native_map(data):
    # A bad *other* legacy entry can abort the native AddSavedConfigurations loop.
    if not data.get("Name") or data["Name"] in BUILTIN_NAMES:
        raise SetupError("Starszy zapis IFC ma brakującą lub zastrzeżoną nazwę.")
    booleans = [key for key, label in FLAGS] + [
        "VisibleElementsInCurrentView", "UseActiveViewGeometry", "ExportRoomsInView",
        "StoreIFCGUID", "ExportUserDefinedPsets", "ExportUserDefinedParameterMapping"]
    for key in booleans:
        if key in data and data[key].lower() not in ("true", "false"):
            raise SetupError("Uszkodzony starszy setup {0}, pole {1}.".format(data["Name"], key))
    if data.get("Version", "IFC2x3CV2") not in VERSION_NAMES.values():
        raise SetupError("Nieznana wersja w starszym setupie " + data["Name"])
    if data.get("FileFormat", "Ifc") not in ("Ifc", "IfcXML", "IfcZIP", "IfcXMLZIP"):
        raise SetupError("Nieznany format pliku w starszym setupie " + data["Name"])
    try:
        if int(data.get("SpaceBoundaryLevel", "0")) not in (0, 1, 2):
            raise ValueError()
        phase = int(data.get("ActivePhase", "-1"))
        if phase < -1 or phase > 9223372036854775807:
            raise ValueError()
    except ValueError:
        raise SetupError("Nieprawidłowa faza lub granice pomieszczeń w " + data["Name"])


def _records(doc):
    schema = _map_schema()
    modern = Schema.Lookup(Guid(JSON_SCHEMA_ID))
    records = []
    legacy_names = set()
    for storage in DB.FilteredElementCollector(doc).OfClass(DataStorage):
        raw, source, data = None, None, None
        if modern is not None:
            entity = storage.GetEntity(modern)
            if entity.IsValid():
                raw = text(entity.Get[String]("MapField"))
                source = json.loads(raw)
                if not isinstance(source, dict) or not source.get("Name"):
                    raise SetupError("Nieprawidłowy JSON setupu IFC w modelu.")
        if schema is not None:
            entity = storage.GetEntity(schema)
            if entity.IsValid():
                native = entity.Get[IDictionary[String, String]]("MapField")
                data = dict((text(pair.Key), text(pair.Value)) for pair in native)
                _validate_native_map(data)
                if data["Name"] in legacy_names:
                    raise SetupError("Powielona nazwa w starszych setupach IFC: " + data["Name"])
                legacy_names.add(data["Name"])
        if source is not None or data is not None:
            if source is not None and data is not None and source["Name"] != data["Name"]:
                raise SetupError("Dwa różne setupy IFC na jednym elemencie danych. Zapis zablokowany.")
            records.append({"uid": text(storage.UniqueId),
                            "name": text(source["Name"] if source is not None else data["Name"]),
                            "source": source, "json": raw, "legacy": data})
    return sorted(records, key=lambda item: (item["name"].lower(), item["uid"]))


def _selected(records, expected):
    matches = [record for record in records if record["uid"] == expected["uid"]]
    if len(matches) != 1:
        raise SetupError("Źródłowy setup usunięto lub przeniesiono. Otwórz konfigurator ponownie.")
    current = matches[0]
    require_unchanged(expected, current)
    for other in records:
        if other["uid"] != current["uid"] and other["name"] == current["name"]:
            raise SetupError("Kilka elementów danych używa nazwy {0}. Uporządkuj setupy przed zapisem."
                             .format(current["name"]))
    return current


class _RollbackFailures(DB.IFailuresPreprocessor):
    def __init__(self):
        self.messages = []

    def PreprocessFailures(self, accessor):
        self.messages = [text(item.GetDescriptionText()) for item in accessor.GetFailureMessages()]
        if self.messages:
            return DB.FailureProcessingResult.ProceedWithRollBack
        return DB.FailureProcessingResult.Continue


class IfcSetupStore(object):
    def __init__(self, doc):
        self.doc = doc

    def read(self):
        if not self.doc.IsValidObject:
            raise SetupError("Model został zamknięty.")
        return _records(self.doc)

    def verify(self, expected):
        return _selected(self.read(), expected)

    def write(self, values, expected):
        data = build_map(expected, values)
        doc = self.doc
        if not doc.IsValidObject or doc.IsReadOnly or doc.IsLinked or doc.IsFamilyDocument:
            raise SetupError("Setup można zapisać wyłącznie w edytowalnym projekcie RVT.")
        if doc.IsModifiable:
            raise SetupError("W modelu trwa już transakcja. Zakończ ją przed zapisem setupu.")
        self.verify(expected)
        storage = doc.GetElement(expected["uid"])
        if storage is None:
            raise SetupError("Nie znaleziono elementu danych wybranego setupu.")
        if doc.IsWorkshared:
            ids = List[DB.ElementId]()
            ids.Add(storage.Id)
            checked = DB.WorksharingUtils.CheckoutElements(doc, ids)
            if (not any(item == storage.Id for item in checked)
                    or DB.WorksharingUtils.GetCheckoutStatus(doc, storage.Id)
                    != DB.CheckoutStatus.OwnedByCurrentUser):
                raise SetupError("Setup jest zablokowany przez innego użytkownika. Nie zapisano zmian.")
            # Borrowing can refresh an element from central; recheck before writing.
            self.verify(expected)
            storage = doc.GetElement(expected["uid"])

        transaction = DB.Transaction(doc, "RVTExtractor — ustawienia IFC")
        failures = _RollbackFailures()
        try:
            if transaction.Start() != DB.TransactionStatus.Started:
                raise SetupError("Nie udało się rozpocząć zapisu setupu IFC.")
            options = transaction.GetFailureHandlingOptions()
            options.SetClearAfterRollback(True)
            options.SetForcedModalHandling(True)
            options.SetFailuresPreprocessor(failures)
            transaction.SetFailureHandlingOptions(options)
            schema = _map_schema()
            if schema is None:
                # Exact Autodesk legacy schema definition (Release_20.0.0).
                builder = SchemaBuilder(Guid(SCHEMA_ID))
                builder.SetSchemaName("IFCExportConfigurationMap")
                builder.AddMapField("MapField", String, String)
                schema = builder.Finish()
            native = Dictionary[String, String]()
            for key, value in data.items():
                native.Add(key, value)
            entity = Entity(schema)
            entity.Set[IDictionary[String, String]]("MapField", native)
            storage.SetEntity(entity)
            # Verifies the legacy map *and* unchanged original JSON on that element.
            result = self.verify(dict(expected, legacy=data))
            if transaction.Commit() != DB.TransactionStatus.Committed:
                raise SetupError("Revit wycofał zapis setupu IFC. " + " ".join(failures.messages))
            return result
        finally:
            if transaction.GetStatus() == DB.TransactionStatus.Started:
                transaction.RollBack()
            transaction.Dispose()
