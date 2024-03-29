// Copyright (C) 2023 Andrea Ballestrazzi

import 'package:astali/cards-management/bulletin-board-cards/presentation/bulletin_board_card.dart';
import 'package:astali/cards-management/bulletin-board-cards/bulletin_board_card_id.dart';
import 'package:astali/cards-management/bulletin-board-cards/bulletin_board_card_selection_controller.dart';
import 'package:astali/cards-management/bulletin-board-cards/bulletin_board_cards_manager.dart';
import 'package:astali/input-management/pointer_events.dart';

// FSM
// Bulletin board card
import 'package:astali/cards-management/bulletin-board-cards/bulletin_board_card_fsm.dart'
    as bbcard_fsm;

// Core
import 'package:astali/fsm/fsm_state.dart';
import 'package:astali/fsm/fsm_transition.dart';
import 'package:astali/fsm/finite_state_machine.dart';

// Core and engine
import 'package:flutter/gestures.dart';

/// Represents the alphabet for the states of the bulletin
/// board ND FSM.
enum BulletinBoardFSMStateName { idle, creatingCard, draggingCard }

/// The underlying type of the bulletin board ND FSM.
typedef BulletinBoardNonDeterministicFSMBaseType
    = NonDeterministicFSM<BulletinBoardFSMStateName>;

/// The underlying type of the bulletin board FSM state resolver;
typedef BulletinBoardFSMStateResolverBaseType
    = FSMStateResolver<BulletinBoardFSMStateName>;

/// Represents the interface of a bulletin board FSM state.
abstract class BulletinBoardFSMState
    extends FSMState<BulletinBoardFSMStateName> {
  void setCardsManager(BulletinBoardCardsManager cardsManager);
  void setFiniteStateMachine(BulletinBoardNonDeterministicFSMBaseType fsm);
  void setStateResolver(BulletinBoardFSMStateResolverBaseType resolver);
  void setSelectionController(
      BulletinBoardCardSafeSelectionController selectionController);
  void onPointerHover(PointerHoverEvent pointerHoverEvent);
  void onPointerUp(PointerUpEvent pointerUpEvent);
  void onPointerDown(PointerDownEvent pointerDownEvent);
  void onPointerMove(PointerMoveEvent pointerMoveEvent);
  void onAddCardEvent();
}

/// Utility base class for the bulletin state classes. This represents an invalid
/// state.
class BulletinBoardEmptyFSMState implements BulletinBoardFSMState {
  BulletinBoardEmptyFSMState(BulletinBoardFSMStateName stateName,
      final BulletinBoardCardIDGenerator cardIDGenerator)
      : _stateName = stateName,
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
  void onPointerMove(PointerMoveEvent pointerMoveEvent) {
    _updateCurrentMousePosition(pointerMoveEvent.localPosition);
  }

  @override
  void onStateEnter() {}

  @override
  void onStateLeave() {}

  @override
  void setCardsManager(BulletinBoardCardsManager cardsManager) {
    _cardsManager = cardsManager;
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

  @override
  void setSelectionController(
      BulletinBoardCardSafeSelectionController selectionController) {
    _selectionController = selectionController;
  }

  BulletinBoardCards _getBulletinBoardsCards() {
    assert(_cardsManager != null);
    return _cardsManager!.getBulletinBoardCards();
  }

  /// When transiting trhough one state to another we need to access
  /// shared data between states. This is a temporary solution to
  /// solve a bug where cards are spawned in old mouse positions during
  /// the entering the cardCreating mode.
  /// NOTE: This filed should accessed throug _updateCurrentMousePosition() and
  /// _getCurrentMousePosition() static methods.
  static MousePoint _currentMousePos = const MousePoint(0.0, 0.0);

  final BulletinBoardFSMStateName _stateName;

  final BulletinBoardCardIDGenerator _cardsIDsGenerator;

  BulletinBoardCardsManager? _cardsManager;
  BulletinBoardNonDeterministicFSMBaseType? _ownerFSM;
  BulletinBoardFSMStateResolverBaseType? _stateResolver;
  BulletinBoardCardSafeSelectionController? _selectionController;
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
  void onPointerDown(PointerDownEvent pointerDownEvent) {
    super.onPointerDown(pointerDownEvent);

    // We make a copy of the current selection set because we are possible going
    // to update it in a for loop.
    final BulletinBoardCardSelectionSet selectionSet = {
      ..._selectionController!.getSelectedCardsIDs()
    };

    // For each selected card we want to set the selection state to false in case
    // the pointer hit outside those cards. If this is not the case then
    // the card has set the lock on the selection state and we won't de-select it.
    final BulletinBoardCards cards = _getBulletinBoardsCards();
    for (var cardID in selectionSet) {
      _selectionController!.safeSetCardSelectionStateOrSinkLock(cardID, false);

      if (!BulletinBoardCardSelectionUtils.isCardSelected(
          cardID, _selectionController!)) {
        cards[cardID]!.cardFSM.forceTransitToIdleState();
      }

      final MousePoint oldMousePoint = cards[cardID]!.cardPosition;
      _cardsManager!.updateCard(
          cardID, BulletinBoardCardDataDiff(newMousePoint: oldMousePoint));
    }
  }

  @override
  void onPointerMove(PointerMoveEvent pointerMoveEvent) {
    super.onPointerMove(pointerMoveEvent);

    // If this event is triggered with a valid selection then the
    // user wants to drag the cards. We need to transit to that state.
    assert(_selectionController != null);
    assert(_ownerFSM != null);
    assert(_stateResolver != null);
    if (_selectionController!.getSelectedCardsIDs().isNotEmpty) {
      _ownerFSM!.transit(FSMSimpleTransition(_stateResolver!),
          BulletinBoardFSMStateName.draggingCard);
    }
  }
}

class BulletinBoardCreatingCardFSMState extends BulletinBoardEmptyFSMState {
  BulletinBoardCreatingCardFSMState(
      BulletinBoardCardIDGenerator cardsIdGenerator)
      : super(BulletinBoardFSMStateName.creatingCard, cardsIdGenerator);

  @override
  void onStateEnter() {
    assert(_selectionController != null);
    // If this method is called then we are coming from the idle state (becase it is the
    // only other state for this FSM). In this case we need to spawn a new card because the
    // user clicked on the "add card" button.
    _spawningCardID = _cardsIDsGenerator.generateID();
    assert(_spawningCardID != null);
    final BulletinBoardCardKey cardKey = BulletinBoardCardKey(_spawningCardID!);

    _cardsManager!.addCard(BulletinBoardCard(
      key: cardKey,
      cardFSM: bbcard_fsm.BulletinBoardCardNonDeterministicFSM(
          _cardsManager!, _selectionController!),
      cardPosition: BulletinBoardEmptyFSMState._getCurrentMousePosition(),
    ));
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
      _cardsManager!.deleteCard(_spawningCardID!);
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
    assert(_selectionController != null);

    _cardsManager!.updateCard(
        _spawningCardID!,
        BulletinBoardCardDataDiff(
            newMousePoint:
                BulletinBoardEmptyFSMState._getCurrentMousePosition()));
  }

  void _transitToIdleMode() {
    assert(_ownerFSM != null);
    assert(_stateResolver != null);
    _ownerFSM!.transit(
        FSMSimpleTransition(_stateResolver!), BulletinBoardFSMStateName.idle);
  }

  BulletinBoardCardID? _spawningCardID;
}

class BulletinBoardDraggingCardFSMState extends BulletinBoardEmptyFSMState {
  BulletinBoardDraggingCardFSMState(
      final BulletinBoardCardIDGenerator generator)
      : super(BulletinBoardFSMStateName.draggingCard, generator);

  @override
  void onStateEnter() {
    super.onStateEnter();

    _updateLastMousePosition();
    _updateCurrentSelection();
  }

  @override
  void onStateLeave() {
    super.onStateLeave();

    // We need to sink the locks of the cards if they have one.
    _sinkSelectionLocks();
  }

  @override
  void onPointerMove(PointerMoveEvent pointerMoveEvent) {
    super.onPointerMove(pointerMoveEvent);

    _updateCurrentSelection();
    _updateLastMousePosition();
  }

  @override
  void onPointerUp(PointerUpEvent pointerUpEvent) {
    super.onPointerUp(pointerUpEvent);

    // We need to exit this state, the user finished the drag of the card.
    assert(_ownerFSM != null);
    assert(_stateResolver != null);
    _ownerFSM!.transit(
        FSMSimpleTransition(_stateResolver!), BulletinBoardFSMStateName.idle);
  }

  void _updateCurrentSelection() {
    // We need to get the current selection ad dragging the card.
    assert(_selectionController != null);
    assert(_cardsManager != null);

    final BulletinBoardCardSelectionSet selectionSet =
        _selectionController!.getSelectedCardsIDs();

    BulletinBoardCardsManagerQuerist querist =
        BulletinBoardCardsManagerQuerist(_cardsManager!);

    for (var cardID in selectionSet) {
      // If the card is in editing state then we don't need to move it.
      final BulletinBoardCard currentCard = querist.getCard(cardID);
      if (bbcard_fsm.BulletinBoardCardFSMUtils.isInEditingState(
          currentCard.cardFSM)) {
        continue;
      }

      final MousePoint dragOffset =
          BulletinBoardEmptyFSMState._getCurrentMousePosition() -
              _lastMousePosition;

      final MousePoint oldCardPosition = currentCard.cardPosition;
      final MousePoint newCardPosition = oldCardPosition + dragOffset;

      _cardsManager!.updateCard(
          cardID, BulletinBoardCardDataDiff(newMousePoint: newCardPosition));
    }
  }

  void _updateLastMousePosition() {
    _lastMousePosition = BulletinBoardEmptyFSMState._getCurrentMousePosition();
  }

  void _sinkSelectionLocks() {
    assert(_selectionController != null);
    assert(_cardsManager != null);

    // We need to get the current selection ad dragging the card.
    final BulletinBoardCardSelectionSet selectionSet =
        _selectionController!.getSelectedCardsIDs();

    for (var cardID in selectionSet) {
      // Here we don't want to de-select the card after the drag so we need
      // to preserve the selection state. However, since there is a lock
      // setted on the selection state (done before the drag) we need to sink
      // that lock so the next time the user clicks on the bulletin board
      // the card can be de-selected.
      BulletinBoardCardSelectionUtils.safeSinkLockAndPreserveState(
          cardID, _selectionController!);
    }
  }

  MousePoint _lastMousePosition = const MousePoint(0.0, 0.0);
}

/// Represents the FSM that realizes the bulletin board non-deterministic finite state machine.
class BulletinBoardNonDeterministicFSM
    extends NonDeterministicFSM<BulletinBoardFSMStateName>
    implements FSMStateResolver<BulletinBoardFSMStateName> {
  BulletinBoardNonDeterministicFSM(
      BulletinBoardCardIDGenerator cardsIDsGenerator,
      BulletinBoardCardSafeSelectionController safeSelectionController)
      : _fsmStates = {
          BulletinBoardFSMStateName.idle:
              BulletinBoardIdleFSMState(cardsIDsGenerator),
          BulletinBoardFSMStateName.creatingCard:
              BulletinBoardCreatingCardFSMState(cardsIDsGenerator),
          BulletinBoardFSMStateName.draggingCard:
              BulletinBoardDraggingCardFSMState(cardsIDsGenerator)
        },
        _safeSelectionController = safeSelectionController,
        super(DeferredInitializationFSMState());

  BulletinBoardFSMState getCurrentState() {
    return _fsmStates[getCurrentStateName()]!;
  }

  /// Used to initialize the finite state machine. Initializes all of its states.
  void initialize(BulletinBoardCardsManager cardsManager) {
    transit(FSMTransitionToInitialState<BulletinBoardFSMStateName>(this),
        BulletinBoardFSMStateName.idle);

    _fsmStates.forEach((key, state) {
      state.setFiniteStateMachine(this);
      state.setStateResolver(this);
      state.setSelectionController(_safeSelectionController);
      state.setCardsManager(cardsManager);
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
  final BulletinBoardCardSafeSelectionController _safeSelectionController;
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

  void processOnPointerMoveEvent(PointerMoveEvent pointerMoveEvent) {
    _getCurrentState().onPointerMove(pointerMoveEvent);
  }

  BulletinBoardFSMState _getCurrentState() {
    return _fsm.getCurrentState();
  }

  final BulletinBoardNonDeterministicFSM _fsm;
}
