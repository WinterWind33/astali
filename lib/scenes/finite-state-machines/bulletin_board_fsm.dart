// Copyright (C) 2023 Andrea Ballestrazzi

import 'package:astali/cards-management/user-interface/cards/bulletin_board_card.dart';

import 'package:astali/input-management/pointer_events.dart';
import 'package:flutter/gestures.dart';

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

abstract class BulletinBoardFSMState extends FSMState<BulletinBoardFSMStateName> {
  void setBulletinCardsList(List<BulletinBoardCard> cards);
  void onPointerHover(PointerHoverEvent pointerHoverEvent);
  void onPointerUp(PointerUpEvent pointerUpEvent);
  void onPointerDown(PointerDownEvent pointerDownEvent);
  void onAddCardEvent();
}

class BulletinBoardEmptyFSMState implements BulletinBoardFSMState {
  BulletinBoardEmptyFSMState(BulletinBoardFSMStateName stateName) :
    _cardsList = List.empty(),
    _stateName = stateName;

  @override
  BulletinBoardFSMStateName getStateName() {
    return _stateName;
  }

  @override
  void onAddCardEvent() {}

  @override
  void onPointerDown(PointerDownEvent pointerDownEvent) {}

  @override
  void onPointerHover(PointerHoverEvent pointerHoverEvent) {}

  @override
  void onPointerUp(PointerUpEvent pointerUpEvent) {}

  @override
  void onStateEnter() {}

  @override
  void onStateLeave() {}

  @override
  void setBulletinCardsList(List<BulletinBoardCard> cards) {
    _cardsList = cards;
  }

  final BulletinBoardFSMStateName _stateName;
  List<BulletinBoardCard> _cardsList;
}

class BulletinBoardIdleFSMState extends BulletinBoardEmptyFSMState {
  BulletinBoardIdleFSMState() :
    super(BulletinBoardFSMStateName.idle);
}

class BulletinBoardCreatingCardFSMState extends BulletinBoardEmptyFSMState {
  BulletinBoardCreatingCardFSMState() :
    super(BulletinBoardFSMStateName.creatingCard);
}

class BulletinBoardNonDeterministicFSM extends NonDeterministicFSM<BulletinBoardFSMStateName> implements FSMStateResolver<BulletinBoardFSMStateName> {
  BulletinBoardNonDeterministicFSM() :
    _fsmStates = {
      BulletinBoardFSMStateName.idle: BulletinBoardIdleFSMState(),
      BulletinBoardFSMStateName.creatingCard: BulletinBoardCreatingCardFSMState()
    },
    super(DeferredInitializationFSMState());

  BulletinBoardFSMState getCurrentState() {
    return _fsmStates[getCurrentStateName()]!;
  }

  void initialize(List<BulletinBoardCard> boardCardsList) {
    transit(FSMTransitionToInitialState<BulletinBoardFSMStateName>(this), BulletinBoardFSMStateName.idle);

    _fsmStates.forEach((key, state) {
      state.setBulletinCardsList(boardCardsList);
    });
  }

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
