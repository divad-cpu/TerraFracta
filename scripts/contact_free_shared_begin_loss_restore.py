"""Empty invented custody never proves an unresolved admission is absent.

Reuses qualified G/H snapshots and held scrub without creating a report or
opening shared writer/recovery. Fixed fresh-cluster driver only.
"""
import json
from contact_free_combined_restore import CombinedRestore
from contact_free_shared_restore_native import quote
class BeginLossRestore(CombinedRestore):
    def finish(self):
        self.report='e9800000-0000-4000-8000-000000000001' # Never inserted; held read stays held.
        self.at=self.received+1
        self.sql(f'begin;update tf_contact_free_trial.clock_state set now_ms={self.at};update tf_bound_trial.clock_state set now_ms={self.at};commit;')
        latest=self.capture('EMPTY_CUSTODY_LATEST')
        self.latest_targets=self.value(self.target_query+';')
        plan=self.plan(latest,'empty_current')
        self.check('begin_loss_empty_H_plan_qualified',plan['kind'],'planned_invented_shared_restore')
        self.check('begin_loss_empty_plan_keeps_original_pending',len(plan['latestAdmission']['reservations']),1)
        self.check('begin_loss_empty_plan_keeps_zero_records',plan['recordActions'],[])
        self.check('begin_loss_empty_plan_keeps_zero_effects',plan['operationActions'],[])
        original_ticket=self.copy['sharedInventory']['admission']['reservations'][0]['ticket']
        self.check('begin_loss_empty_original_ticket_unchanged',plan['latestAdmission']['reservations'][0]['ticket'],original_ticket)
        self.restore('tf_begin_loss_restored')
        self.scrub('tf_begin_loss_restored',plan)
        self.check('begin_loss_empty_restored_payloads',self.value(self.payload_query+';','tf_begin_loss_restored'),[])
        self.check('begin_loss_empty_restored_records',self.value(self.records_query+';','tf_begin_loss_restored'),[])
        self.check('begin_loss_empty_reserved_debt_retained',self.value(self.shared_queries['reservations']+';','tf_begin_loss_restored')[0]['ticket'],original_ticket)
        self.check('begin_loss_empty_shared_context_stays_held',self.sql('select known from tf_shared_admission_trial.context;',database='tf_begin_loss_restored').stdout.strip(),'f')
        self.check('begin_loss_empty_owner_inventory_not_restart',self.value('select tf_shared_inventory_trial.capture_invented('+quote(self.execution)+');','tf_begin_loss_restored','tf_shared_inventory'),{'kind':'held'})
        self.at=self.received+180*86400000
        self.sql(f'begin;update tf_contact_free_trial.clock_state set now_ms={self.at};update tf_bound_trial.clock_state set now_ms={self.at};commit;')
        aged=self.capture('EMPTY_ORIGINAL_180D')
        expired={'ticket':original_ticket,'operationId':None,'admittedAtMs':None,'phase':'expired','requestId':None,'target':None}
        self.check('begin_loss_original_identity_retired_without_releasing_debt',aged['admission']['reservations'],[expired])
        aged_plan=self.plan(aged,'empty_expired')
        self.check('begin_loss_original_expiry_H_plan_qualified',aged_plan['kind'],'planned_invented_shared_restore')
        self.check('begin_loss_original_expiry_H_debt_still_opaque',aged_plan['latestAdmission']['reservations'],[expired])
        self.restore('tf_begin_loss_expired')
        self.scrub('tf_begin_loss_expired',aged_plan)
        self.check('begin_loss_expired_copy_has_no_original_reference',self.value(self.shared_queries['reservations']+';','tf_begin_loss_expired'),[{'ticket':original_ticket,'operation_id':None,'admitted_at_ms':None,'phase':'expired','request_id':None,'target':None}])
        self.check('begin_loss_expired_copy_stays_admission_held',self.sql('select known from tf_shared_admission_trial.context;',database='tf_begin_loss_expired').stdout.strip(),'f')
