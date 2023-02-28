// Copyright (c) 2023 Andrea Ballestrazzi

// FSM
import 'package:astali/fsm/fsm_state.dart' as fsm_core;
import 'package:astali/fsm/fsm_transition.dart' as fsm_core;
import 'package:astali/fsm/finite_state_machine.dart' as fsm_core;

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

class BulletinBoardCardFSMStateBase implements BulletinBoardCardFSMState {
  const BulletinBoardCardFSMStateBase(final BulletinBoardCardFSMStateName name)
      : _stateName = name;

  @override
  BulletinBoardCardFSMStateName getStateName() {
    return _stateName;
  }

  @override
  void onCardDeletionRequested() {}

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
}

class BulletinBoardCardIdleFSMState extends BulletinBoardCardFSMStateBase {
  const BulletinBoardCardIdleFSMState()
      : super(BulletinBoardCardFSMStateName.idle);
}

typedef BulletinBoardCardFSMType
    = fsm_core.NonDeterministicFSM<BulletinBoardCardFSMStateName>;

typedef BulletinBoardCardFSMStateResolverType
    = fsm_core.FSMStateResolver<BulletinBoardCardFSMStateName>;

class BulletinBoardCardNonDeterministicFSM extends BulletinBoardCardFSMType
    implements BulletinBoardCardFSMStateResolverType {
  BulletinBoardCardNonDeterministicFSM()
      : _fsmStates = {
          BulletinBoardCardFSMStateName.idle:
              const BulletinBoardCardIdleFSMState()
        },
        super(fsm_core.DeferredInitializationFSMState());

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

  final Map<BulletinBoardCardFSMStateName, BulletinBoardCardFSMState>
      _fsmStates;
}
