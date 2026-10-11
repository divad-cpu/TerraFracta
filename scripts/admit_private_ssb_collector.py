"""Bind the unconnected private collector to caller-confirmed identities.

Reuses one-shot fixed-context binding. This is not a collector CLI or proof of
source permission, native admission, transport truth or selected live storage.
"""
import os
from scripts.admit_frozen_ssb_launch import AdmittedFrozenFixtureLaunch
from scripts.ssb_execution_inventory import runtime_record
from workers.ssb_frozen_private_collector import check_private_collector_source, private_collector_child_command


class AdmittedPrivateCollectorLaunch(AdmittedFrozenFixtureLaunch):
    def _verify_source(self):
        payload=check_private_collector_source(self.source)
        if payload['interpreter']!=runtime_record():
            raise ValueError('Private collector interpreter changed')

    def _command(self,connection):
        return private_collector_child_command('worker',self.source,channel=connection.fileno(),
            context_sha256=self.context_sha256,parent_pid=os.getpid())
