// Copyright (C) 2023 Andrea Ballestrazzi

// FSM
import 'package:astali/fsm/fsm_state.dart';
import 'package:astali/fsm/fsm_transition.dart';
import 'package:astali/fsm/finite_state_machine.dart';

/// Represents the alphabet for the states of the bulletin
/// board ND FSM.
enum BulletinBoardFSMStateName {
  idle,
  creatingCard
}

typedef BulletinBoardFSMState = FSMState<BulletinBoardFSMStateName>;

class BulletinBoardIdleFSMState implements BulletinBoardFSMState {
  @override
  BulletinBoardFSMStateName getStateName() {
    return BulletinBoardFSMStateName.idle;
  }

  @override
  void onStateEnter() {
  }

  @override
  void onStateLeave() {
  }
}

class BulletinBoardCreatingCardFSMState implements BulletinBoardFSMState {
  @override
  BulletinBoardFSMStateName getStateName() {
    return BulletinBoardFSMStateName.creatingCard;
  }

  @override
  void onStateEnter() {
  }

  @override
  void onStateLeave() {
  }
}

class BulletinBoardFSMStateResolver implements FSMStateResolver<BulletinBoardFSMStateName> {
  BulletinBoardFSMStateResolver() :
    _alphabet = BulletinBoardFSMStateName.values.toSet();

  @override
  Set<BulletinBoardFSMStateName> getAlphabet() {
    return _alphabet;
  }

  @override
  FSMState<BulletinBoardFSMStateName> getState(BulletinBoardFSMStateName stateName) {
    switch (stateName) {
      case BulletinBoardFSMStateName.creatingCard:
        return BulletinBoardCreatingCardFSMState();
      default:
        return BulletinBoardIdleFSMState();
    }
  }

  final Set<BulletinBoardFSMStateName> _alphabet;

}

class BulletinBoardNonDeterministicFSM extends NonDeterministicFSM<BulletinBoardFSMStateName> implements FSMStateResolver<BulletinBoardFSMStateName> {
  BulletinBoardNonDeterministicFSM() :
    _fsmStates = {
      BulletinBoardFSMStateName.idle: BulletinBoardIdleFSMState(),
      BulletinBoardFSMStateName.creatingCard: BulletinBoardCreatingCardFSMState()
    },
    super(BulletinBoardIdleFSMState());

  @override
  Set<BulletinBoardFSMStateName> getAlphabet() {
    return _fsmStates.keys.toSet();
  }

  @override
  FSMState<BulletinBoardFSMStateName> getState(BulletinBoardFSMStateName stateName) {
    assert(_fsmStates.containsKey(stateName));
    return _fsmStates[stateName]!;
  }

  bool isInIdleMode() {
    return isInState(this, BulletinBoardFSMStateName.idle);
  }

  bool isInCreatingCardMode() {
    return isInState(this, BulletinBoardFSMStateName.creatingCard);
  }

  void transitToIdleMode() {
    transit(FSMSimpleTransition(this), BulletinBoardFSMStateName.idle);
  }

  void transitToCreatingCardMode() {
    transit(FSMSimpleTransition(this), BulletinBoardFSMStateName.creatingCard);
  }

  final Map<BulletinBoardFSMStateName, BulletinBoardFSMState> _fsmStates;
}
