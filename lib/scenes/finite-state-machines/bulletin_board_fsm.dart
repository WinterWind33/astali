// Copyright (C) 2023 Andrea Ballestrazzi

import 'package:astali/cards-management/bulletin-board-cards/presentation/bulletin_board_card.dart';
import 'package:astali/cards-management/bulletin-board-cards/bulletin_board_card_id.dart';
import 'package:astali/input-management/pointer_events.dart';

// FSM
import 'package:astali/fsm/fsm_state.dart';
import 'package:astali/fsm/fsm_transition.dart';
import 'package:astali/fsm/finite_state_machine.dart';

// Core and engine
import 'package:flutter/gestures.dart';

/// Represents the alphabet for the states of the bulletin
/// board ND FSM.
enum BulletinBoardFSMStateName { idle, creatingCard }

/// The underlying type of the bulletin board ND FSM.
typedef BulletinBoardNonDeterministicFSMBaseType
    = NonDeterministicFSM<BulletinBoardFSMStateName>;

/// The underlying type of the bulletin board FSM state resolver;
typedef BulletinBoardFSMStateResolverBaseType
    = FSMStateResolver<BulletinBoardFSMStateName>;

typedef BulletinBoardCards = Map<BulletinBoardCardID, BulletinBoardCard>;

/// Represents the interface of a bulletin board FSM state.
abstract class BulletinBoardFSMState
    extends FSMState<BulletinBoardFSMStateName> {
  void setBulletinCardsList(BulletinBoardCards cards);
  void setFiniteStateMachine(BulletinBoardNonDeterministicFSMBaseType fsm);
  void setStateResolver(BulletinBoardFSMStateResolverBaseType resolver);
  void onPointerHover(PointerHoverEvent pointerHoverEvent);
  void onPointerUp(PointerUpEvent pointerUpEvent);
  void onPointerDown(PointerDownEvent pointerDownEvent);
  void onAddCardEvent();
  void onCardSelectionChanged(BulletinBoardCardID cardID, bool bIsSelected);
}

/// Utility base class for the bulletin state classes. This represents an invalid
/// state.
class BulletinBoardEmptyFSMState implements BulletinBoardFSMState {
  BulletinBoardEmptyFSMState(BulletinBoardFSMStateName stateName,
      final BulletinBoardCardIDGenerator cardIDGenerator)
      : _stateName = stateName,
        _cardsList = {},
        _currentlySelectedCards = List.empty(growable: true),
        _cardsIDsGenerator = cardIDGenerator;

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
  void onCardSelectionChanged(BulletinBoardCardID cardID, bool bIsSelected) {
    if (bIsSelected) {
      _currentlySelectedCards.add(cardID);
    } else {
      // If the card is deselected then it previously must be selected. If this is not
      // the case there is a problems with the bulletin board FSM states.
      assert(_currentlySelectedCards.contains(cardID));
      _currentlySelectedCards.remove(cardID);
    }
  }

  @override
  void setBulletinCardsList(BulletinBoardCards cards) {
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

  final BulletinBoardCardIDGenerator _cardsIDsGenerator;
  final BulletinBoardFSMStateName _stateName;

  BulletinBoardCards _cardsList;
  BulletinBoardNonDeterministicFSMBaseType? _ownerFSM;
  BulletinBoardFSMStateResolverBaseType? _stateResolver;
  List<BulletinBoardCardID> _currentlySelectedCards;
}

class BulletinBoardIdleFSMState extends BulletinBoardEmptyFSMState {
  BulletinBoardIdleFSMState(BulletinBoardCardIDGenerator cardsIDsGenerator)
      : super(BulletinBoardFSMStateName.idle, cardsIDsGenerator);

  @override
  void onAddCardEvent() {
    assert(_ownerFSM != null);
    assert(_stateResolver != null);

    super.onAddCardEvent();

    // We are in idle state, so the user wants to create a card.
    // We can migrate to that state.
    _ownerFSM!.transit(FSMSimpleTransition(_stateResolver!),
        BulletinBoardFSMStateName.creatingCard);
  }

  @override
  void onPointerUp(PointerUpEvent pointerUpEvent) {
    super.onPointerUp(pointerUpEvent);

    // We need to remove all the cards from the selection list.
    for (var cardID in _currentlySelectedCards) {
      final MousePoint oldMousePoint = _cardsList[cardID]!.cardPosition;
      _cardsList[cardID] = BulletinBoardCard(
          cardID: cardID,
          cardPosition: oldMousePoint,
          onBulletinBoardCardSelected: onCardSelectionChanged,
          bSelected: false);
    }
  }
}

class BulletinBoardCreatingCardFSMState extends BulletinBoardEmptyFSMState {
  BulletinBoardCreatingCardFSMState(
      BulletinBoardCardIDGenerator cardsIdGenerator)
      : super(BulletinBoardFSMStateName.creatingCard, cardsIdGenerator);

  @override
  void onStateEnter() {
    // If this method is called then we are coming from the idle state (becase it is the
    // only other state for this FSM). In this case we need to spawn a new card because the
    // user clicked on the "add card" button.
    _spawningCardID = _cardsIDsGenerator.generateID();
    _cardsList[_spawningCardID!] = (BulletinBoardCard(
        cardID: _spawningCardID!,
        onBulletinBoardCardSelected: onCardSelectionChanged,
        cardPosition: BulletinBoardEmptyFSMState._getCurrentMousePosition()));
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
    if (isRightMouseButton(pointerDownEvent.buttons)) {
      // We need to remove the last card.
      _cardsList.remove(_spawningCardID);
      _spawningCardID = null;
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
    assert(_spawningCardID != null);

    _cardsList[_spawningCardID!] = BulletinBoardCard(
        cardID: _spawningCardID!,
        onBulletinBoardCardSelected: onCardSelectionChanged,
        cardPosition: BulletinBoardEmptyFSMState._getCurrentMousePosition());
  }

  void _transitToIdleMode() {
    assert(_ownerFSM != null);
    assert(_stateResolver != null);
    _ownerFSM!.transit(
        FSMSimpleTransition(_stateResolver!), BulletinBoardFSMStateName.idle);
  }

  BulletinBoardCardID? _spawningCardID;
}

/// Represents the FSM that realizes the bulletin board non-deterministic finite state machine.
class BulletinBoardNonDeterministicFSM
    extends NonDeterministicFSM<BulletinBoardFSMStateName>
    implements FSMStateResolver<BulletinBoardFSMStateName> {
  BulletinBoardNonDeterministicFSM(
      BulletinBoardCardIDGenerator cardsIDsGenerator)
      : _fsmStates = {
          BulletinBoardFSMStateName.idle:
              BulletinBoardIdleFSMState(cardsIDsGenerator),
          BulletinBoardFSMStateName.creatingCard:
              BulletinBoardCreatingCardFSMState(cardsIDsGenerator)
        },
        super(DeferredInitializationFSMState());

  BulletinBoardFSMState getCurrentState() {
    return _fsmStates[getCurrentStateName()]!;
  }

  /// Used to initialize the finite state machine. Initializes all of its states.
  void initialize(BulletinBoardCards boardCardsList) {
    transit(FSMTransitionToInitialState<BulletinBoardFSMStateName>(this),
        BulletinBoardFSMStateName.idle);

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
  FSMState<BulletinBoardFSMStateName> getState(
      BulletinBoardFSMStateName stateName) {
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
  const BulletinBoardFSMEventDispatcher(BulletinBoardNonDeterministicFSM fsm)
      : _fsm = fsm;

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
