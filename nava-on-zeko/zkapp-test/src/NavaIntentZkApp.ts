import 'reflect-metadata';
import { Bool, Field, Permissions, SmartContract, State, method, state } from 'o1js';
import {
  APPROVED_STATUS_CODE,
  ZekoVerifierQuorum,
  buildApprovalDomainCommitment,
  buildApprovalMessageFields,
  computeVerifierSetRoot
} from './zekoVerifierAttestation.js';

const STATUS = Object.freeze({
  PENDING: Field(0),
  APPROVED: Field(APPROVED_STATUS_CODE),
  EXECUTED: Field(2),
  SETTLED: Field(3),
  REJECTED: Field(4),
  UNDECIDED: Field(5)
});

const MAX_VERIFIER_APPROVALS = Field(5);
const EMPTY_VERIFIER_SET_ROOT = computeVerifierSetRoot([]);

function matchesAny(value: Field, candidates: Field[]) {
  let match = Bool(false);
  for (const candidate of candidates) {
    match = match.or(value.equals(candidate));
  }
  return match;
}

function assertSupportedStatus(status: Field) {
  matchesAny(status, Object.values(STATUS)).assertTrue('unsupported_status_code');
}

export class NavaIntentZkApp extends SmartContract {
  @state(Field) intentHash = State<Field>();
  @state(Field) statementHash = State<Field>();
  @state(Field) approvalCommitment = State<Field>();
  @state(Field) status = State<Field>();
  @state(Field) requiredVerifierApprovals = State<Field>();
  @state(Field) observedVerifierApprovals = State<Field>();
  @state(Field) approvalDomainCommitment = State<Field>();
  @state(Field) lastUpdatedAt = State<Field>();

  init() {
    super.init();
    this.intentHash.set(Field(0));
    this.statementHash.set(Field(0));
    this.approvalCommitment.set(Field(0));
    this.status.set(Field(0));
    this.requiredVerifierApprovals.set(Field(0));
    this.observedVerifierApprovals.set(Field(0));
    this.approvalDomainCommitment.set(Field(0));
    this.lastUpdatedAt.set(Field(0));
    this.account.permissions.set({
      ...Permissions.default(),
      editState: Permissions.proof()
    });
  }

  @method async approveWithVerifierQuorum(
    nextStatementHash: Field,
    nextApprovalCommitment: Field,
    nextLastUpdatedAt: Field,
    quorum: ZekoVerifierQuorum
  ) {
    const currentIntentHash = this.intentHash.getAndRequireEquals();
    this.statementHash.getAndRequireEquals();
    this.approvalCommitment.getAndRequireEquals();
    const currentStatus = this.status.getAndRequireEquals();
    const quorumThreshold = this.requiredVerifierApprovals.getAndRequireEquals();
    const currentObservedVerifierApprovals = this.observedVerifierApprovals.getAndRequireEquals();
    const approvalDomainCommitment = this.approvalDomainCommitment.getAndRequireEquals();
    const currentLastUpdatedAt = this.lastUpdatedAt.getAndRequireEquals();

    currentStatus
      .equals(STATUS.PENDING)
      .or(currentStatus.equals(STATUS.UNDECIDED))
      .assertTrue('approval_requires_pending_or_undecided');
    approvalDomainCommitment.assertNotEquals(Field(0), 'approval_domain_commitment_required');
    quorumThreshold.assertGreaterThan(Field(0), 'positive_quorum_required');
    quorumThreshold.assertLessThanOrEqual(MAX_VERIFIER_APPROVALS);
    nextLastUpdatedAt.assertGreaterThan(currentLastUpdatedAt);

    const providedVerifierSetRoot = computeVerifierSetRoot(quorum.publicKeys);
    buildApprovalDomainCommitment({
      verifierSetRoot: providedVerifierSetRoot
    }).assertEquals(approvalDomainCommitment, 'verifier_set_root_mismatch');

    const messageFields = buildApprovalMessageFields({
      intentHash: currentIntentHash,
      quorumThreshold,
      approvalDomainCommitment
    });

    let observedApprovals = Field(0);
    for (let index = 0; index < quorum.enabled.length; index += 1) {
      const enabled = quorum.enabled[index];
      const verified = quorum.signatures[index].verify(quorum.publicKeys[index], messageFields);
      enabled.and(verified.not()).assertFalse('invalid_verifier_signature');
      observedApprovals = observedApprovals.add(enabled.toField());
    }

    observedApprovals.assertGreaterThanOrEqual(currentObservedVerifierApprovals);
    observedApprovals.assertGreaterThanOrEqual(quorumThreshold);

    this.statementHash.set(nextStatementHash);
    this.approvalCommitment.set(nextApprovalCommitment);
    this.status.set(STATUS.APPROVED);
    this.observedVerifierApprovals.set(observedApprovals);
    this.lastUpdatedAt.set(nextLastUpdatedAt);
  }

  @method async syncLifecycle(
    nextStatementHash: Field,
    nextApprovalCommitment: Field,
    nextStatus: Field,
    nextObservedVerifierApprovals: Field,
    nextLastUpdatedAt: Field
  ) {
    this.intentHash.getAndRequireEquals();
    this.statementHash.getAndRequireEquals();
    this.approvalCommitment.getAndRequireEquals();
    const currentStatus = this.status.getAndRequireEquals();
    const currentRequiredVerifierApprovals = this.requiredVerifierApprovals.getAndRequireEquals();
    const currentObservedVerifierApprovals = this.observedVerifierApprovals.getAndRequireEquals();
    this.approvalDomainCommitment.getAndRequireEquals();
    const currentLastUpdatedAt = this.lastUpdatedAt.getAndRequireEquals();

    assertSupportedStatus(currentStatus);
    assertSupportedStatus(nextStatus);

    currentRequiredVerifierApprovals.assertLessThanOrEqual(MAX_VERIFIER_APPROVALS);
    nextObservedVerifierApprovals.assertLessThanOrEqual(MAX_VERIFIER_APPROVALS);
    nextObservedVerifierApprovals.assertGreaterThanOrEqual(currentObservedVerifierApprovals);
    nextLastUpdatedAt.assertGreaterThan(currentLastUpdatedAt);

    const currentIsPending = currentStatus.equals(STATUS.PENDING);
    const currentIsApproved = currentStatus.equals(STATUS.APPROVED);
    const currentIsExecuted = currentStatus.equals(STATUS.EXECUTED);
    const currentIsSettled = currentStatus.equals(STATUS.SETTLED);
    const currentIsRejected = currentStatus.equals(STATUS.REJECTED);
    const currentIsUndecided = currentStatus.equals(STATUS.UNDECIDED);

    const nextIsPending = nextStatus.equals(STATUS.PENDING);
    const nextIsApproved = nextStatus.equals(STATUS.APPROVED);
    const nextIsExecuted = nextStatus.equals(STATUS.EXECUTED);
    const nextIsSettled = nextStatus.equals(STATUS.SETTLED);
    const nextIsRejected = nextStatus.equals(STATUS.REJECTED);
    const nextIsUndecided = nextStatus.equals(STATUS.UNDECIDED);

    const currentPreApproval = currentIsPending.or(currentIsUndecided);
    const currentExecutedOrSettled = currentIsExecuted.or(currentIsSettled);
    const quorumRequired = nextIsApproved.or(nextIsExecuted).or(nextIsSettled);
    const quorumSatisfied = nextObservedVerifierApprovals.greaterThanOrEqual(currentRequiredVerifierApprovals);

    quorumRequired.and(quorumSatisfied.not()).assertFalse('quorum_required_before_progress');
    currentRequiredVerifierApprovals.greaterThan(Field(0)).and(nextIsApproved).assertFalse('signature_quorum_required_for_approval');

    const canStayPending = currentIsPending.and(nextIsPending);
    const canMarkUndecided = currentPreApproval.and(nextIsUndecided);
    const canApprove = currentRequiredVerifierApprovals.equals(Field(0)).and(currentPreApproval.or(currentIsApproved)).and(nextIsApproved);
    const canReject = currentPreApproval.and(nextIsRejected);
    const canExecute = currentIsApproved.and(nextIsExecuted);
    const canSettle = currentExecutedOrSettled.and(nextIsSettled);
    const canStayRejected = currentIsRejected.and(nextIsRejected);

    canStayPending
      .or(canMarkUndecided)
      .or(canApprove)
      .or(canReject)
      .or(canExecute)
      .or(canSettle)
      .or(canStayRejected)
      .assertTrue('invalid_lifecycle_transition');

    this.statementHash.set(nextStatementHash);
    this.approvalCommitment.set(nextApprovalCommitment);
    this.status.set(nextStatus);
    this.observedVerifierApprovals.set(nextObservedVerifierApprovals);
    this.lastUpdatedAt.set(nextLastUpdatedAt);
  }
}
