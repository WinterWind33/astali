// Copyright (C) 2023 Andrea Ballestrazzi

// Core dependencies
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

typedef BulletinBoardNonDeterministicFSM = NonDeterministicFSM<BulletinBoardFSMStateName>;
