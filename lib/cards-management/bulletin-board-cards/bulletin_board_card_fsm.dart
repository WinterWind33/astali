// Copyright (c) 2023 Andrea Ballestrazzi

// FSM
import 'package:astali/fsm/fsm_state.dart' as fsm_core;
import 'package:astali/fsm/fsm_transition.dart' as fsm_core;
import 'package:astali/fsm/finite_state_machine.dart' as fsm_core;
import 'package:astali/scenes/finite-state-machines/bulletin_board_fsm.dart';

// Core and engine
import 'package:flutter/cupertino.dart';

/// Bulletin Board Card FSM state names.
enum BulletinBoardCardFSMStateName { idle, selected, editing, deleting }

typedef BulletinBaordCardFSMStateType
    = fsm_core.FSMState<BulletinBoardCardFSMStateName>;

abstract class BulletinBoardCardFSMState extends BulletinBaordCardFSMStateType {
  void onPointerUpOnCard(PointerUpEvent pointerUpEvent);
  void onPointerDownOnCard(PointerDownEvent pointerDownEvent);
  void onCardFocusChanged(bool bHasFocus);
  void onCardDeletionRequested();
}

typedef BulletinBoardCardFSMType
    = fsm_core.NonDeterministicFSM<BulletinBoardCardFSMStateName>;

typedef BulletinBoardCardFSMStateResolverType
    = fsm_core.FSMStateResolver<BulletinBoardCardFSMStateName>;

class BulletinBoardCardFSMStateBase implements BulletinBoardCardFSMState {
  const BulletinBoardCardFSMStateBase(
      final BulletinBoardCardFSMStateName name,
      final BulletinBoardCardFSMType ownerFSM,
      final BulletinBoardCardFSMStateResolverType stateResolver)
      : _stateName = name,
        _ownerFSM = ownerFSM,
        _stateResolver = stateResolver;

  @override
  BulletinBoardCardFSMStateName getStateName() {
    return _stateName;
  }

  @override
  void onCardDeletionRequested() {
    if (_stateName != BulletinBoardCardFSMStateName.deleting) {
      _ownerFSM.transit(fsm_core.FSMSimpleTransition(_stateResolver),
          BulletinBoardCardFSMStateName.deleting);
    }
  }

  @override
  void onCardFocusChanged(bool bHasFocus) {}

  @override
  void onPointerDownOnCard(PointerDownEvent pointerDownEvent) {}

  @override
  void onPointerUpOnCard(PointerUpEvent pointerUpEvent) {}

  @override
  void onStateEnter() {}

  @override
  void onStateLeave() {}

  final BulletinBoardCardFSMStateName _stateName;
  final BulletinBoardCardFSMType _ownerFSM;
  final BulletinBoardCardFSMStateResolverType _stateResolver;
}

class BulletinBoardCardIdleFSMState extends BulletinBoardCardFSMStateBase {
  const BulletinBoardCardIdleFSMState(final BulletinBoardCardFSMType ownerFSM,
      final BulletinBoardCardFSMStateResolverType stateResolver)
      : super(BulletinBoardCardFSMStateName.idle, ownerFSM, stateResolver);

  @override
  void onPointerDownOnCard(PointerDownEvent pointerDownEvent) {
    // We need to go to the selected state, because the pointer is
    // down on this specified card.
    _ownerFSM.transit(fsm_core.FSMSimpleTransition(_stateResolver),
        BulletinBoardCardFSMStateName.selected);
  }
}

class BulletinBoardCardSelectedFSMState extends BulletinBoardCardFSMStateBase {
  const BulletinBoardCardSelectedFSMState(
      final BulletinBoardCardFSMType ownerFSM,
      final BulletinBoardCardFSMStateResolverType stateResolver)
      : super(BulletinBoardCardFSMStateName.selected, ownerFSM, stateResolver);

  @override
  void onCardFocusChanged(bool bHasFocus) {
    // We should be here only when the card has focus because
    // when it loses the focus the card should be in editing state.
    assert(bHasFocus);

    _ownerFSM.transit(fsm_core.FSMSimpleTransition(_stateResolver),
        BulletinBoardCardFSMStateName.editing);
  }
}

class BulletinBoardCardEditingFSMState extends BulletinBoardCardFSMStateBase {
  const BulletinBoardCardEditingFSMState(
      final BulletinBoardCardFSMType ownerFSM,
      final BulletinBoardCardFSMStateResolverType stateResolver)
      : super(BulletinBoardCardFSMStateName.editing, ownerFSM, stateResolver);

  @override
  void onCardFocusChanged(bool bHasFocus) {
    assert(!bHasFocus);

    _ownerFSM.transit(fsm_core.FSMSimpleTransition(_stateResolver),
        BulletinBoardCardFSMStateName.selected);
  }
}

class BulletinBoardCardDeletingFSMState extends BulletinBoardCardFSMStateBase {
  const BulletinBoardCardDeletingFSMState(
      final BulletinBoardCardFSMType ownerFSM,
      final BulletinBoardCardFSMStateResolverType stateResolver)
      : super(BulletinBoardCardFSMStateName.deleting, ownerFSM, stateResolver);
}

abstract class BulletinBoardCardFiniteStateMachine
    extends BulletinBoardCardFSMType {
  BulletinBoardCardFiniteStateMachine()
      : super(fsm_core.DeferredInitializationFSMState());

  void initialize();

  void forceTransitToIdleState();

  BulletinBoardCardFSMState getCurrentState();
}

class BulletinBoardCardFSMUtils {
  static bool isInIdleState(BulletinBoardCardFSMType fsm) {
    return fsm.getCurrentStateName() == BulletinBoardCardFSMStateName.idle;
  }

  static bool isInSelectedState(BulletinBoardCardFSMType fsm) {
    return fsm.getCurrentStateName() == BulletinBoardCardFSMStateName.selected;
  }

  static bool isInEditingState(BulletinBoardCardFSMType fsm) {
    return fsm.getCurrentStateName() == BulletinBoardCardFSMStateName.editing;
  }

  static bool isInSelectedOrEditingState(BulletinBoardCardFSMType fsm) {
    return isInSelectedState(fsm) || isInEditingState(fsm);
  }
}

class BulletinBoardCardNonDeterministicFSM
    extends BulletinBoardCardFiniteStateMachine
    implements BulletinBoardCardFSMStateResolverType {
  BulletinBoardCardNonDeterministicFSM() : super();

  @override
  Set<BulletinBoardCardFSMStateName> getAlphabet() {
    return _fsmStates.keys.toSet();
  }

  @override
  fsm_core.FSMState<BulletinBoardCardFSMStateName> getState(
      BulletinBoardCardFSMStateName stateName) {
    if (_fsmStates.containsKey(stateName)) {
      return _fsmStates[stateName]!;
    }

    throw UnimplementedError();
  }

  @override
  void initialize() {
    // Before going to the initial state we need to allocate all the states
    // for this card.
    _fsmStates = {
      BulletinBoardCardFSMStateName.idle:
          BulletinBoardCardIdleFSMState(this, this),
      BulletinBoardCardFSMStateName.selected:
          BulletinBoardCardSelectedFSMState(this, this),
      BulletinBoardCardFSMStateName.editing:
          BulletinBoardCardEditingFSMState(this, this),
      BulletinBoardCardFSMStateName.deleting:
          BulletinBoardCardDeletingFSMState(this, this)
    };

    _transitToIdleState();
  }

  @override
  void forceTransitToIdleState() {
    if (!BulletinBoardCardFSMUtils.isInIdleState(this)) {
      _transitToIdleState();
    }
  }

  @override
  BulletinBoardCardFSMState getCurrentState() {
    return _fsmStates[getCurrentStateName()]!;
  }

  void _transitToIdleState() {
    transit(
        fsm_core.FSMSimpleTransition(this), BulletinBoardCardFSMStateName.idle);
  }

  Map<BulletinBoardCardFSMStateName, BulletinBoardCardFSMState> _fsmStates = {};
}
