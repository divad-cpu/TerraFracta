"""Read-only checks for Docker's shared local Supabase database aliases."""

from __future__ import annotations

from collections.abc import Mapping, Sequence


class DatabaseTargetError(ValueError):
    """The fixed local database cannot be identified unambiguously."""


def validate_database_network(
    network: Mapping, containers: Sequence[Mapping], *, before_start: bool = False
) -> None:
    """Validate inspected metadata only; never connect, stop or repair anything."""
    expected = "supabase_db_terrafracta-local"
    network_name = "terrafracta-local-loopback"
    if (
        network.get("Name") != network_name
        or network.get("Driver") != "bridge"
        or network.get("Options", {}).get(
            "com.docker.network.bridge.host_binding_ipv4"
        ) != "127.0.0.1"
    ):
        raise DatabaseTargetError("The fixed database network lacks its loopback binding.")
    members = network.get("Containers")
    if not isinstance(members, Mapping):
        raise DatabaseTargetError("Database network membership is unavailable.")
    if set(members) != {item.get("id") for item in containers}:
        raise DatabaseTargetError("Database network membership changed during inspection.")
    primary = None
    for item in containers:
        name = item.get("name")
        if not isinstance(name, str):
            raise DatabaseTargetError("A network member cannot be identified.")
        attached = item.get("networks", {}).get(network_name)
        if not isinstance(attached, Mapping):
            raise DatabaseTargetError("Database network attachment changed during inspection.")
        aliases = attached.get("Aliases")
        dns_names = attached.get("DNSNames", [])
        if not isinstance(aliases, list) or not isinstance(dns_names, list):
            raise DatabaseTargetError("Database aliases are unavailable.")
        if name != expected and (
            name.startswith("supabase_db_")
            or any(alias in {"db", "db.supabase.internal"} for alias in aliases + dns_names)
        ):
            raise DatabaseTargetError(
                "Another database shares the primary network. Give test instances separate networks."
            )
        if name == expected:
            if primary is not None:
                raise DatabaseTargetError("The primary database appears more than once.")
            primary = item
    if primary is None:
        if before_start:
            return
        raise DatabaseTargetError("The fixed primary database is not attached to its network.")
    if primary.get("running") is not True or primary.get("ports", {}).get("5432/tcp") != [
        {"HostIp": "127.0.0.1", "HostPort": "65432"}
    ]:
        raise DatabaseTargetError("The primary database lacks its exact running loopback port.")

