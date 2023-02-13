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

typedef BulletinBoardNonDeterministicFSMBaseType = NonDeterministicFSM<BulletinBoardFSMStateName>;
typedef BulletinBoardFSMStateResolverBaseType = FSMStateResolver<BulletinBoardFSMStateName>;

abstract class BulletinBoardFSMState extends FSMState<BulletinBoardFSMStateName> {
  void setBulletinCardsList(List<BulletinBoardCard> cards);
  void setFiniteStateMachine(BulletinBoardNonDeterministicFSMBaseType fsm);
  void setStateResolver(BulletinBoardFSMStateResolverBaseType resolver);
  void onPointerHover(PointerHoverEvent pointerHoverEvent);
  void onPointerUp(PointerUpEvent pointerUpEvent);
  void onPointerDown(PointerDownEvent pointerDownEvent);
  void onAddCardEvent();
}

/// Utility base class for the bulletin state classes. This represents an invalid
/// state.
class BulletinBoardEmptyFSMState implements BulletinBoardFSMState {
  BulletinBoardEmptyFSMState(BulletinBoardFSMStateName stateName) :
    _stateName = stateName,
    _cardsList = List.empty(),
    _currentMousePos = const MousePoint(0.0, 0.0);


  @override
  BulletinBoardFSMStateName getStateName() {
    return _stateName;
  }

  @override
  void onAddCardEvent() {}

  @override
  void onPointerDown(PointerDownEvent pointerDownEvent) {
    _updateMousePosition(pointerDownEvent.localPosition);
  }

  @override
  void onPointerHover(PointerHoverEvent pointerHoverEvent) {
    _updateMousePosition(pointerHoverEvent.localPosition);
  }

  @override
  void onPointerUp(PointerUpEvent pointerUpEvent) {
    _updateMousePosition(pointerUpEvent.localPosition);
  }

  @override
  void onStateEnter() {}

  @override
  void onStateLeave() {}

  @override
  void setBulletinCardsList(List<BulletinBoardCard> cards) {
    _cardsList = cards;
  }

  @override
  void setFiniteStateMachine(BulletinBoardNonDeterministicFSMBaseType fsm) {
    _ownerFSM = fsm;
  }

  @override
  void setStateResolver(BulletinBoardFSMStateResolverBaseType stateResolver) {
    _stateResolver = stateResolver;
  }

  void _updateMousePosition(final Offset localPosition) {
    _currentMousePos = MousePoint(localPosition.dx, localPosition.dy);
  }

  final BulletinBoardFSMStateName _stateName;
  List<BulletinBoardCard> _cardsList;
  MousePoint _currentMousePos;
  BulletinBoardNonDeterministicFSMBaseType? _ownerFSM;
  BulletinBoardFSMStateResolverBaseType? _stateResolver;
}

class BulletinBoardIdleFSMState extends BulletinBoardEmptyFSMState {
  BulletinBoardIdleFSMState() :
    super(BulletinBoardFSMStateName.idle);

  @override
  void onAddCardEvent() {
    assert(_ownerFSM != null);
    assert(_stateResolver != null);

    // We are in idle state, so the user wants to create a card.
    // We can migrate to that state.
    _ownerFSM!.transit(FSMSimpleTransition(_stateResolver!), BulletinBoardFSMStateName.creatingCard);
  }
}

class BulletinBoardCreatingCardFSMState extends BulletinBoardEmptyFSMState {
  BulletinBoardCreatingCardFSMState() :
    super(BulletinBoardFSMStateName.creatingCard);

    @override
    void onStateEnter() {
      // If this method is called then we are coming from the idle state (becase it is the
      // only other state for this FSM). In this case we need to spawn a new card because the
      // user clicked on the "add card" button.
      _cardsList.add(BulletinBoardCard(cardPosition: _currentMousePos));
    }
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
      state.setFiniteStateMachine(this);
      state.setStateResolver(this);
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

void processOnAddCardEvent(BulletinBoardNonDeterministicFSM fsm) {
  fsm.getCurrentState().onAddCardEvent();
}
