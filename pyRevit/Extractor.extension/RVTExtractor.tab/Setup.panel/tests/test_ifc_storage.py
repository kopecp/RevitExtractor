"""Transaction boundaries with a fake host; live Revit acceptance is separate."""
import importlib.util
import os
import sys
import types
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "ExportSetup.pushbutton"))
from extractor_config import SetupError
from extractor_ifc import build_map, proposal
from test_ifc import modern_record


class Generic:
    def __init__(self, constructor):
        self.constructor = constructor

    def __getitem__(self, args):
        return self.constructor


class NativeDictionary(dict):
    def Add(self, key, value):
        self[key] = value


class NativeList(list):
    def Add(self, item):
        self.append(item)


def load_storage():
    modules = {}
    for name in ("System", "System.Collections.Generic", "pyrevit",
                 "Autodesk.Revit.DB.ExtensibleStorage"):
        modules[name] = types.ModuleType(name)
    modules["System"].Guid = str
    modules["System"].String = str
    generics = modules["System.Collections.Generic"]
    generics.Dictionary = Generic(NativeDictionary)
    generics.IDictionary = Generic(dict)
    generics.List = Generic(NativeList)
    modules["pyrevit"].DB = types.SimpleNamespace(IFailuresPreprocessor=object)
    storage = modules["Autodesk.Revit.DB.ExtensibleStorage"]
    for name in ("Schema", "SchemaBuilder", "Entity", "DataStorage", "ContainerType", "AccessLevel"):
        setattr(storage, name, Mock())
    path = os.path.join(os.path.dirname(os.path.dirname(__file__)),
                        "ExportSetup.pushbutton", "extractor_ifc_storage.py")
    spec = importlib.util.spec_from_file_location("ifc_storage_under_test", path)
    module = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, modules):
        spec.loader.exec_module(module)
    return module


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.module = load_storage()
        self.doc = types.SimpleNamespace(IsValidObject=True, IsReadOnly=False,
            IsLinked=False, IsFamilyDocument=False, IsModifiable=False, IsWorkshared=False)
        self.storage = Mock(UniqueId="one", Id=123)
        self.expected = modern_record()
        self.values, unused = proposal(self.expected)
        self.module._records = Mock(return_value=[self.expected])
        self.doc.GetElement = Mock(return_value=self.storage)
        self.module._map_schema = Mock(return_value="schema")
        self.transaction = Mock()
        self.transaction.Start.return_value = "Started"
        self.transaction.GetStatus.return_value = "Started"
        self.transaction.Commit.return_value = "Committed"
        self.transaction.Commit.side_effect = self.commit
        self.db = types.SimpleNamespace(
            Transaction=Mock(return_value=self.transaction),
            TransactionStatus=types.SimpleNamespace(Started="Started", Committed="Committed"),
            ElementId=int, WorksharingUtils=Mock(),
            CheckoutStatus=types.SimpleNamespace(OwnedByCurrentUser="mine"))
        self.module.DB = self.db
        self.entity = types.SimpleNamespace(Set=Generic(Mock()))
        self.module.Entity = Mock(return_value=self.entity)
        self.store = self.module.IfcSetupStore(self.doc)
        self.storage.SetEntity.side_effect = lambda entity: setattr(
            self.module._records, "return_value", [dict(self.expected, legacy=build_map(self.expected, self.values))])

    def commit(self):
        self.transaction.GetStatus.return_value = self.transaction.Commit.return_value
        return self.transaction.Commit.return_value

    def test_apply_changes_only_target_entity_and_commits(self):
        result = self.store.write(self.values, self.expected)
        self.assertEqual(result["legacy"]["ExportLinkedFiles"], "True")
        self.assertEqual(result["source"], self.expected["source"])
        self.assertEqual(result["json"], self.expected["json"])
        self.storage.SetEntity.assert_called_once_with(self.entity)
        self.module.DataStorage.Create.assert_not_called()
        self.transaction.Commit.assert_called_once()
        self.transaction.RollBack.assert_not_called()
        self.transaction.Dispose.assert_called_once()
        # Fake document intentionally has no Save, SaveAs, Delete or Synchronize method.

    def test_missing_source_never_creates_new_setup(self):
        self.module._records.return_value = []
        with self.assertRaises(SetupError):
            self.store.write(self.values, self.expected)
        self.module.DataStorage.Create.assert_not_called()
        self.db.Transaction.assert_not_called()

    def test_readonly_linked_family_and_nested_transaction_do_not_start_write(self):
        for attr in ("IsReadOnly", "IsLinked", "IsFamilyDocument", "IsModifiable"):
            setattr(self.doc, attr, True)
            with self.assertRaises(SetupError):
                self.store.write(self.values, self.expected)
            setattr(self.doc, attr, False)
        self.db.Transaction.assert_not_called()

    def test_stale_and_foreign_setup_do_not_start_transaction(self):
        with self.assertRaises(SetupError):
            self.store.write(self.values, dict(self.expected, json="changed"))
        self.module._records.return_value = [self.expected, dict(self.expected, uid="duplicate")]
        with self.assertRaises(SetupError):
            self.store.write(self.values, self.expected)
        self.db.Transaction.assert_not_called()

    def test_entity_write_failure_rolls_back(self):
        self.storage.SetEntity.side_effect = RuntimeError("write failed")
        with self.assertRaises(RuntimeError):
            self.store.write(self.values, self.expected)
        self.transaction.RollBack.assert_called_once()
        self.transaction.Commit.assert_not_called()
        self.transaction.Dispose.assert_called_once()

    def test_failed_readback_rolls_back(self):
        self.storage.SetEntity.side_effect = None
        with self.assertRaises(SetupError):
            self.store.write(self.values, self.expected)
        self.transaction.RollBack.assert_called_once()
        self.transaction.Commit.assert_not_called()

    def test_failed_commit_is_not_reported_as_success(self):
        self.transaction.Commit.return_value = "RolledBack"
        with self.assertRaises(SetupError):
            self.store.write(self.values, self.expected)

    def test_denied_checkout_stops_before_transaction(self):
        self.doc.IsWorkshared = True
        self.db.WorksharingUtils.CheckoutElements.return_value = []
        with self.assertRaises(SetupError):
            self.store.write(self.values, self.expected)
        self.db.Transaction.assert_not_called()

    def test_checkout_refresh_cannot_overwrite_new_central_values(self):
        self.doc.IsWorkshared = True
        self.db.WorksharingUtils.CheckoutElements.return_value = [123]
        self.db.WorksharingUtils.GetCheckoutStatus.return_value = "mine"
        self.module._records.side_effect = [[self.expected], [modern_record(ExportLinkedFiles=0)]]
        with self.assertRaises(SetupError):
            self.store.write(self.values, self.expected)
        self.db.Transaction.assert_not_called()

    def test_original_json_change_during_write_rolls_back(self):
        self.storage.SetEntity.side_effect = lambda entity: setattr(
            self.module._records, "return_value", [dict(self.expected, json="changed",
                legacy=build_map(self.expected, self.values))])
        with self.assertRaises(SetupError):
            self.store.write(self.values, self.expected)
        self.transaction.RollBack.assert_called_once()

    def test_missing_schema_uses_exact_autodesk_map_definition(self):
        self.module._map_schema.return_value = None
        self.store.write(self.values, self.expected)
        builder = self.module.SchemaBuilder.return_value
        builder.SetSchemaName.assert_called_once_with("IFCExportConfigurationMap")
        builder.AddMapField.assert_called_once_with("MapField", str, str)
        self.module.DataStorage.Create.assert_not_called()

    def test_invalid_legacy_entries_are_rejected_before_native_reader_can_abort(self):
        for data in (dict(Name="Bad", ExportLinkedFiles="2"), dict(Name="Bad", Version="unknown"),
                     dict(Name="Bad", SpaceBoundaryLevel="3"), dict(Name="Bad", ActivePhase="abc"),
                     dict(Name="IFC4 Reference View")):
            with self.assertRaises(SetupError):
                self.module._validate_native_map(data)


class ReadRecordsTests(unittest.TestCase):
    def setUp(self):
        self.module = load_storage()
        self.module._map_schema = Mock(return_value="legacy")
        self.module.Schema.Lookup.return_value = "modern"
        self.storages = []
        collector = Mock()
        collector.OfClass.side_effect = lambda cls: self.storages
        self.module.DB.FilteredElementCollector = Mock(return_value=collector)

    def add_storage(self, record):
        def get_entity(schema):
            payload = record["json"] if schema == "modern" else record["legacy"]
            if schema == "legacy" and payload is not None:
                payload = [types.SimpleNamespace(Key=key, Value=value) for key, value in payload.items()]
            return types.SimpleNamespace(IsValid=lambda: payload is not None, Get=Generic(lambda field: payload))
        self.storages.append(types.SimpleNamespace(UniqueId=record["uid"], GetEntity=get_entity))

    def test_json_and_map_on_same_storage_read_as_one_record(self):
        record = modern_record()
        values, unused = proposal(record)
        record["legacy"] = build_map(record, values)
        self.add_storage(record)
        self.assertEqual(self.module._records(object()), [record])

    def test_json_only_is_listed_without_creating_storage(self):
        record = modern_record()
        self.add_storage(record)
        self.assertEqual(self.module._records(object()), [record])
        self.module.DataStorage.Create.assert_not_called()

    def test_two_legacy_records_same_name_are_rejected(self):
        record = modern_record()
        values, unused = proposal(record)
        record["legacy"] = build_map(record, values)
        self.add_storage(record)
        self.add_storage(dict(record, uid="duplicate"))
        with self.assertRaises(SetupError):
            self.module._records(object())

    def test_mismatching_names_on_one_storage_are_rejected(self):
        record = modern_record()
        record["legacy"] = {"Name": "Different"}
        self.add_storage(record)
        with self.assertRaises(SetupError):
            self.module._records(object())

    def test_existing_legacy_setup_is_read_with_its_unknown_fields(self):
        record = dict(uid="legacy-uid", name="Old", source=None, json=None,
                      legacy=dict(Name="Old", Version="IFC4RV", Extra="preserve"))
        self.add_storage(record)
        self.assertEqual(self.module._records(object()), [record])


if __name__ == "__main__":
    unittest.main()
