# -*- coding: utf-8 -*-
"""Generate an Extractor index from the active Revit project's views."""
from __future__ import unicode_literals

__title__ = "Eksport\nsetup"
__doc__ = "Wybierz widoki, przygotuj setup IFC w modelu i zapisz index.json dla Autodesk Revit Extractor."

from pyrevit import forms, revit, script
from extractor_model import collect_views
from extractor_ui import ExportSetupWindow
from extractor_ifc_storage import IfcSetupStore


def main():
    doc = revit.doc
    if doc is None or doc.IsFamilyDocument:
        forms.alert("Otwórz projekt RVT, dla którego chcesz przygotować eksport.",
                    title="Eksport setup")
        return
    try:
        snapshot = collect_views(doc)
        ExportSetupWindow(snapshot, IfcSetupStore(doc)).ShowDialog()
    except Exception as error:
        script.get_logger().exception("Nie udało się otworzyć konfiguratora eksportu.")
        forms.alert("Nie udało się przygotować konfiguracji.\n\n{0}".format(error),
                    title="Eksport setup")


if __name__ == "__main__":
    main()
