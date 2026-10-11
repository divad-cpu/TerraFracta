import copy
import unittest
from unittest.mock import patch
from contextlib import redirect_stdout
from io import StringIO

from scripts.check_local_db_target import main as check_target

from workers.local_database_target import DatabaseTargetError, validate_database_network


class LocalDatabaseTargetTests(unittest.TestCase):
    def test_embedded_target_check_does_not_consume_parent_harness_arguments(self):
        network={"Name":"terrafracta-local-loopback","Driver":"bridge",
                 "Options":{"com.docker.network.bridge.host_binding_ipv4":"127.0.0.1"},
                 "Containers":{}}
        with patch("sys.argv",["parent-test","--installed"]), \
             patch("scripts.check_local_db_target.inspect_json",return_value=[network]), \
             redirect_stdout(StringIO()):
            self.assertEqual(check_target(["--before-start"]),0)
            self.assertEqual(check_target([]),1)

    def setUp(self):
        self.network = {"Name": "terrafracta-local-loopback", "Driver": "bridge",
                        "Options": {"com.docker.network.bridge.host_binding_ipv4": "127.0.0.1"},
                        "Containers": {"primary": {}}}
        self.primary = {"id": "primary", "name": "supabase_db_terrafracta-local", "running": True,
                        "ports": {"5432/tcp": [{"HostIp": "127.0.0.1", "HostPort": "65432"}]},
                        "networks": {"terrafracta-local-loopback": {
                            "Aliases": ["db", "db.supabase.internal"], "DNSNames": ["db"]}}}

    def test_exact_primary_and_unrelated_service(self):
        service = copy.deepcopy(self.primary)
        service.update(id="service", name="supabase_storage_terrafracta-local")
        service["networks"]["terrafracta-local-loopback"] = {"Aliases": ["storage"]}
        self.network["Containers"]["service"] = {}
        validate_database_network(self.network, [self.primary, service])

    def test_other_database_or_database_alias_is_refused(self):
        for name in ("supabase_db_replay", "unrelated-service"):
            with self.subTest(name=name):
                second = copy.deepcopy(self.primary)
                second.update(id="second", name=name)
                self.network["Containers"]["second"] = {}
                with self.assertRaises(DatabaseTargetError):
                    validate_database_network(self.network, [self.primary, second])

    def test_foreign_dns_name_also_refused(self):
        second = copy.deepcopy(self.primary)
        second.update(id="second", name="other")
        second["networks"]["terrafracta-local-loopback"] = {"Aliases": [], "DNSNames": ["db"]}
        self.network["Containers"]["second"] = {}
        with self.assertRaises(DatabaseTargetError):
            validate_database_network(self.network, [self.primary, second])

    def test_missing_primary_only_allowed_before_start(self):
        self.network["Containers"] = {}
        validate_database_network(self.network, [], before_start=True)
        with self.assertRaises(DatabaseTargetError):
            validate_database_network(self.network, [])

    def test_changed_membership_and_nonloopback_ports_refused(self):
        with self.assertRaises(DatabaseTargetError):
            validate_database_network(self.network, [])
        for key, value in (("HostIp", "0.0.0.0"), ("HostPort", "64032")):
            primary = copy.deepcopy(self.primary)
            primary["ports"]["5432/tcp"][0][key] = value
            with self.assertRaises(DatabaseTargetError):
                validate_database_network(self.network, [primary])

    def test_wrong_network_binding_and_missing_alias_metadata_refused(self):
        self.network["Options"] = {}
        with self.assertRaises(DatabaseTargetError):
            validate_database_network(self.network, [self.primary])
        self.network["Options"] = {"com.docker.network.bridge.host_binding_ipv4": "127.0.0.1"}
        self.primary["networks"]["terrafracta-local-loopback"]["Aliases"] = None
        with self.assertRaises(DatabaseTargetError):
            validate_database_network(self.network, [self.primary])
