#!/usr/bin/env python3
"""Offline structural checks for the LightTable architecture examples.

Requires: python -m pip install -r tests/requirements.txt
Run from the package root: python tests/validate-schemas.py
"""
from __future__ import annotations

import copy
import json
from pathlib import Path
import sys

from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource

ROOT = Path(__file__).resolve().parents[1]
SCHEMA_DIR = ROOT / "schemas"
EXAMPLE_DIR = ROOT / "examples"


def load_json(path: Path):
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def build_registry():
    registry = Registry()
    schemas = {}
    for path in sorted(SCHEMA_DIR.glob("*.schema.json")):
        schema = load_json(path)
        Draft202012Validator.check_schema(schema)
        schemas[path.name] = schema
        registry = registry.with_resource(
            schema["$id"], Resource.from_contents(schema)
        )
    return schemas, registry


def assert_valid(schema, instance, registry, label):
    validator = Draft202012Validator(
        schema, registry=registry, format_checker=FormatChecker()
    )
    errors = list(validator.iter_errors(instance))
    if errors:
        details = "\n".join(
            f"  {error.json_path}: {error.message}" for error in errors
        )
        raise AssertionError(f"Expected {label} to be valid:\n{details}")


def assert_invalid(schema, instance, registry, label):
    validator = Draft202012Validator(
        schema, registry=registry, format_checker=FormatChecker()
    )
    errors = list(validator.iter_errors(instance))
    if not errors:
        raise AssertionError(f"Expected {label} to be rejected, but it passed")


def main() -> int:
    schemas, registry = build_registry()
    cases = [
        ("project.schema.json", "project.example.json"),
        ("project-json-bundle.schema.json", "project-json-bundle.example.json"),
        ("package-manifest.schema.json", "package.manifest.example.json"),
        ("plugin-manifest.schema.json", "plugin.manifest.example.json"),
    ]

    for schema_name, example_name in cases:
        assert_valid(
            schemas[schema_name],
            load_json(EXAMPLE_DIR / example_name),
            registry,
            example_name,
        )
        print(f"PASS valid example: {example_name}")

    project_schema = schemas["project.schema.json"]
    project = load_json(EXAMPLE_DIR / "project.example.json")
    bad_project = copy.deepcopy(project)
    # V1 explicitly caps each cel at four content layers.
    any_cel = next(iter(bad_project["cels"].values()))
    any_cel["layers"] = any_cel["layers"] * 5
    assert_invalid(project_schema, bad_project, registry, "five-layer cel")
    print("PASS rejects five-layer cel")

    plugin_schema = schemas["plugin-manifest.schema.json"]
    plugin = load_json(EXAMPLE_DIR / "plugin.manifest.example.json")
    bad_plugin = copy.deepcopy(plugin)
    bad_plugin["permissions"].append("network")
    assert_invalid(plugin_schema, bad_plugin, registry, "network permission without origin allowlist")
    print("PASS rejects network permission without networkOrigins")

    bad_plugin = copy.deepcopy(plugin)
    bad_plugin["entry"] = "dist/../../outside.js"
    assert_invalid(plugin_schema, bad_plugin, registry, "plugin path traversal")
    print("PASS rejects plugin path traversal")

    bundle_schema = schemas["project-json-bundle.schema.json"]
    bundle = load_json(EXAMPLE_DIR / "project-json-bundle.example.json")
    assert_valid(bundle_schema, bundle, registry, "single-file project bundle")
    print("PASS resolves project schema reference locally")

    print("ALL SCHEMA CHECKS PASSED")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # make CI output readable
        print(f"SCHEMA VALIDATION FAILED: {exc}", file=sys.stderr)
        raise
