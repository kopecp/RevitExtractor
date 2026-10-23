# -*- coding: utf-8 -*-
from __future__ import unicode_literals

import copy
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "ExportSetup.pushbutton"))
from extractor_config import SetupError, build_index
from extractor_ifc import (BUILTIN_NAMES, SOURCE_KEY, defaults, build_map, proposal,
                           source_values, require_unchanged)


def modern_record(name="PiKej", **changes):
    source = dict(Name=name, IFCVersion=29, ExportLinkedFiles=2, SpaceBoundaries=1,
                  ExportBaseQuantities=True, Use2DRoomBoundaryForVolume=True,
                  ProjectAddress={"AssignAddressToSite": True}, GeoRefEPSGCode="2180")
    source.update(changes)
    return dict(uid="source-uid", name=name, source=source,
                json=json.dumps(source, ensure_ascii=False), legacy=None)


class IfcTests(unittest.TestCase):
    def test_named_setup_uses_native_path_only_when_ifc_enabled(self):
        for enabled in (True, False):
            result = build_index({"ifc": enabled, "ifc_setup_name": "PiKej"})["metadata"]["parameters"]
            if enabled:
                self.assertEqual(result["direct_params"], {"IFCExportOption": "PiKej"})
            else:
                self.assertNotIn("direct_params", result)

    def test_real_json_enum_shape_converts_same_name_and_preserves_original(self):
        record = modern_record()
        original = copy.deepcopy(record)
        values, notes = proposal(record)
        self.assertEqual(values["Version"], "IFC4RV")
        self.assertTrue(values["ExportLinkedFiles"])
        self.assertTrue(values["ExportBaseQuantities"])
        self.assertTrue(values["Use2DBoundariesForRoomVolume"])
        data = build_map(record, values)
        self.assertEqual(data["Name"], "PiKej")
        self.assertEqual(data["ExportLinkedFiles"], "True")
        self.assertEqual(data["FileFormat"], "Ifc")
        self.assertEqual(data["ActivePhase"], "-1")
        self.assertEqual(data["VisibleElementsInCurrentView"], "False")
        self.assertEqual(data[SOURCE_KEY], record["json"])
        self.assertEqual(record, original)
        self.assertIn("IFC4x3", " ".join(notes))
        self.assertIn("osobne pliki", " ".join(notes))
        self.assertIn("GeoRefEPSGCode", " ".join(notes))

    def test_link_modes_and_versions_keep_known_supported_choices(self):
        for version, target in ((21, "IFC2x3CV2"), (25, "IFC4RV"), (26, "IFC4DTV"),
                                (29, "IFC4RV"), ("IFC4x3", "IFC4RV")):
            values, unused = proposal(modern_record(IFCVersion=version))
            self.assertEqual(values["Version"], target)
        for mode in (0, 1, 2, 3, "DontExport", "ExportAsSeparate", "ExportSameProject", "ExportSameSite"):
            values, unused = proposal(modern_record(ExportLinkedFiles=mode))
            self.assertEqual(values["ExportLinkedFiles"], mode not in (0, "DontExport"))

    def test_prepared_edits_reload_until_autodesk_source_changes(self):
        record = modern_record()
        values, unused = proposal(record)
        values.update(ExportLinkedFiles=False, Version="IFC2x3CV2")
        prepared = dict(record, legacy=build_map(record, values))
        reread, unused = proposal(prepared)
        self.assertEqual(reread, values)
        self.assertEqual(build_map(prepared, reread), prepared["legacy"])
        changed = modern_record(ExportBaseQuantities=False)
        changed["legacy"] = prepared["legacy"]
        reread, notes = proposal(changed)
        self.assertFalse(reread["ExportBaseQuantities"])
        self.assertTrue(reread["ExportLinkedFiles"])
        self.assertNotEqual(build_map(changed, reread), changed["legacy"])

    def test_legacy_edit_preserves_other_native_settings_and_extensions(self):
        data = dict(Name="Starszy", Version="IFC4RV", ExportLinkedFiles="False",
                    ActivePhase="12345678901", ExportUserDefinedPsets="True",
                    ExportUserDefinedPsetsFileName="C:\\Model\\psets.txt", ThirdParty="keep")
        record = dict(uid="old", name="Starszy", source=None, json=None, legacy=data)
        values, unused = proposal(record)
        values["ExportLinkedFiles"] = True
        result = build_map(record, values)
        for key in ("ActivePhase", "ExportUserDefinedPsets", "ExportUserDefinedPsetsFileName", "ThirdParty"):
            self.assertEqual(result[key], data[key])
        self.assertEqual(data["ExportLinkedFiles"], "False")

    def test_unknown_link_enum_and_invalid_scalar_fail_instead_of_exporting_broadly(self):
        for change in ({"ExportLinkedFiles": 4}, {"ExportLinkedFiles": {}},
                       {"ExportBaseQuantities": "yes"}, {"ExportBaseQuantities": 1},
                       {"SpaceBoundaries": 3}):
            with self.assertRaises(SetupError):
                proposal(modern_record(**change))

    def test_missing_optional_fields_use_native_defaults(self):
        record = modern_record()
        record["source"] = {"Name": "PiKej", "ExportSpecificSchedules": None}
        values, unused = source_values(record)
        self.assertEqual(values, defaults())

    def test_builtin_name_collision_is_blocked(self):
        for name in BUILTIN_NAMES:
            with self.assertRaises(SetupError):
                proposal(modern_record(name))

    def test_stale_deleted_and_recreated_sources_are_rejected(self):
        original = modern_record()
        require_unchanged(original, copy.deepcopy(original))
        for current in (None, dict(original, uid="another"), modern_record(ExportLinkedFiles=0)):
            with self.assertRaises(SetupError):
                require_unchanged(original, current)


if __name__ == "__main__":
    unittest.main()
