# -*- coding: utf-8 -*-
from __future__ import unicode_literals

import json
import os
import sys
import unittest

BUNDLE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "ExportSetup.pushbutton")
sys.path.insert(0, BUNDLE)
from extractor_config import SetupError, build_index, filter_records, to_json


def derivative(settings=None, two=None, three=None):
    return build_index(settings, two, three)["metadata"]["parameters"]["derivative_type"]


class ConfigTests(unittest.TestCase):
    def test_default_matches_existing_minimal_preset(self):
        self.assertEqual(derivative(), {
            "2dviewing": {}, "3dviewing": {}, "properties_data": {"pdb": True}})

    def test_single_floor_plan_disables_3d(self):
        result = derivative({"enable_3d": False, "scope_2d": "selected"}, ["floor-uid"])
        self.assertNotIn("3dviewing", result)
        self.assertEqual(result["2dviewing"], {"view_unique_ids": ["floor-uid"]})

    def test_sheets_and_floor_plans_share_one_2d_selection(self):
        result = derivative({"scope_2d": "selected"}, ["sheet-uid", "floor-uid", "sheet-uid"])
        self.assertEqual(result["2dviewing"]["view_unique_ids"], ["floor-uid", "sheet-uid"])

    def test_selected_mode_cannot_fall_back_to_default(self):
        for dimension in ("2d", "3d"):
            with self.assertRaises(SetupError):
                derivative({"scope_" + dimension: "selected"})

    def test_disabled_branch_ignores_its_empty_selection(self):
        result = derivative({"enable_2d": False, "scope_2d": "selected"})
        self.assertNotIn("2dviewing", result)

    def test_default_scope_ignores_previous_checked_items(self):
        self.assertEqual(derivative(two=["old-uid"])["2dviewing"], {})

    def test_2d_and_3d_selections_remain_separate(self):
        result = derivative({"scope_2d": "selected", "scope_3d": "selected"}, ["plan"], ["3d"])
        self.assertEqual(result["2dviewing"]["view_unique_ids"], ["plan"])
        self.assertEqual(result["3dviewing"]["view_unique_ids"], ["3d"])

    def test_properties_can_be_disabled_explicitly(self):
        result = derivative({"pdb": False, "extended_properties": True})
        self.assertEqual(result["properties_data"], {"pdb": False})
        self.assertNotIn("metadata", result)

    def test_database_only_cannot_be_misread_as_all_views(self):
        self.assertEqual(derivative({"enable_2d": False, "enable_3d": False}),
                         {"properties_data": {"pdb": True}})

    def test_nothing_to_export_is_rejected(self):
        with self.assertRaises(SetupError):
            derivative({"enable_2d": False, "enable_3d": False, "pdb": False})

    def test_all_advanced_options_have_explicit_native_paths(self):
        result = derivative({"aec_model_data": False, "design_description": False,
                             "generate_master_views": True, "topology_metadata": True,
                             "extended_properties": True, "f2d": True, "dwg": True, "ifc": True})
        self.assertEqual(result["3dviewing"], {
            "aec_model_data": False, "design_description": False,
            "generate_master_views": True, "topology_metadata": True})
        self.assertEqual(result["metadata"], {"extended_properties": True})
        self.assertEqual(result["2dviewing"], {"f2d": True})
        self.assertEqual(result["export"]["to"], ["dwg", "ifc"])

    def test_export_formats_do_not_enable_viewing_branches(self):
        result = derivative({"enable_2d": False, "enable_3d": False, "pdb": False, "ifc": True})
        self.assertNotIn("3dviewing", result)
        self.assertNotIn("2dviewing", result)
        self.assertEqual(result["export"]["to"], ["ifc"])

    def test_json_roundtrip_preserves_ids(self):
        payload = build_index({"scope_2d": "selected"}, ["c8923f5e-6a14-4420-9b1d-c31d7ae067d2-00000020"])
        self.assertEqual(json.loads(to_json(payload)), payload)

    def test_search_and_type_filter_do_not_mutate_selection_records(self):
        records = [
            {"uid": "a", "kind": "Arkusze", "search": "a101 — rzut piętra arkusze 9001"},
            {"uid": "b", "kind": "Rzuty kondygnacji", "search": "rzut piętra 9002"},
        ]
        self.assertEqual(filter_records(records, "RZUT 9001", "Arkusze"), [records[0]])
        self.assertEqual(filter_records(records, "piętra", "Rzuty kondygnacji"), [records[1]])
        self.assertEqual(len(records), 2)


if __name__ == "__main__":
    unittest.main()
