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

/// The underlying type of the bulletin board ND FSM.
typedef BulletinBoardNonDeterministicFSMBaseType = NonDeterministicFSM<BulletinBoardFSMStateName>;

/// The underlying type of the bulletin board FSM state resolver;
typedef BulletinBoardFSMStateResolverBaseType = FSMStateResolver<BulletinBoardFSMStateName>;

/// Represents the interface of a bulletin board FSM state.
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
    _cardsList = List.empty();

  @override
  BulletinBoardFSMStateName getStateName() {
    return _stateName;
  }

  @override
  void onAddCardEvent() {}

  @override
  void onPointerDown(PointerDownEvent pointerDownEvent) {
    _updateCurrentMousePosition(pointerDownEvent.localPosition);
  }

  @override
  void onPointerHover(PointerHoverEvent pointerHoverEvent) {
    _updateCurrentMousePosition(pointerHoverEvent.localPosition);
  }

  @override
  void onPointerUp(PointerUpEvent pointerUpEvent) {
    _updateCurrentMousePosition(pointerUpEvent.localPosition);
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

  static void _updateCurrentMousePosition(final Offset mousePos) {
    _currentMousePos = MousePoint(mousePos.dx, mousePos.dy);
  }

  static MousePoint _getCurrentMousePosition() {
    return _currentMousePos;
  }

  /// When transiting trhough one state to another we need to access
  /// shared data between states. This is a temporary solution to
  /// solve a bug where cards are spawned in old mouse positions during
  /// the entering the cardCreating mode.
  /// NOTE: This filed should accessed throug _updateCurrentMousePosition() and
  /// _getCurrentMousePosition() static methods.
  static MousePoint _currentMousePos = const MousePoint(0.0, 0.0);

  final BulletinBoardFSMStateName _stateName;
  List<BulletinBoardCard> _cardsList;
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

    super.onAddCardEvent();

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
      _cardsList.add(BulletinBoardCard(cardPosition: BulletinBoardEmptyFSMState._getCurrentMousePosition()));
    }

    @override
    void onPointerHover(PointerHoverEvent pointerHoverEvent) {
      super.onPointerHover(pointerHoverEvent);

      // We have a card that is being spawned, so we need to update its current
      // position on the window viewport.
      _updateCreatingCard();
    }

    @override
    void onPointerDown(PointerDownEvent pointerDownEvent) {
      super.onPointerDown(pointerDownEvent);

      // In this case we want to check if the user right-clicked. In that case the
      // user wants to delete the spawning card.
      if(isRightMouseButton(pointerDownEvent.buttons)) {
        // We need to remove the last card.
        _cardsList.removeLast();
      }

      // Now that the user deleted the card we can transit to the idle mode.
      _transitToIdleMode();
    }

    @override
    void onPointerUp(PointerUpEvent pointerUpEvent) {
      super.onPointerUp(pointerUpEvent);

      // In this case we want to confirm the card, so we update its position and
      // we transit to the idle mode.
      _updateCreatingCard();
      _transitToIdleMode();
    }

    void _updateCreatingCard() {
      _cardsList.last = BulletinBoardCard(cardPosition: BulletinBoardEmptyFSMState._getCurrentMousePosition());
    }

    void _transitToIdleMode() {
      assert(_ownerFSM != null);
      assert(_stateResolver != null);
      _ownerFSM!.transit(FSMSimpleTransition(_stateResolver!), BulletinBoardFSMStateName.idle);
    }
}

/// Represents the FSM that realizes the bulletin board non-deterministic finite state machine.
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

  /// Used to initialize the finite state machine. Initializes all of its states.
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

  void teardown() {
    transit(FSMSimpleTransition(this), BulletinBoardFSMStateName.idle);
  }

  final Map<BulletinBoardFSMStateName, BulletinBoardFSMState> _fsmStates;
}

/// Utility class that partially solves violation of the Law of Demeter by
/// wrapping up the bulletin board FSM and calling the corresponding
/// event on the curren FSM state.
class BulletinBoardFSMEventDispatcher {
  const BulletinBoardFSMEventDispatcher(BulletinBoardNonDeterministicFSM fsm) :
    _fsm = fsm;

  void processOnAddCardEvent() {
    _getCurrentState().onAddCardEvent();
  }

  void processOnPointerHoverEvent(PointerHoverEvent pointerHoverEvent) {
    _getCurrentState().onPointerHover(pointerHoverEvent);
  }

  void processOnPointerDownEvent(PointerDownEvent pointerDownEvent) {
    _getCurrentState().onPointerDown(pointerDownEvent);
  }

  void processOnPointerUpEvent(PointerUpEvent pointerUpEvent) {
    _getCurrentState().onPointerUp(pointerUpEvent);
  }

  BulletinBoardFSMState _getCurrentState() {
    return _fsm.getCurrentState();
  }

  final BulletinBoardNonDeterministicFSM _fsm;
}
