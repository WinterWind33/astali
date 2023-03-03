// Copyright (c) 2023 Andrea Ballestrazzi

import 'bulletin_board_card_id.dart';
import 'bulletin_board_cards_manager.dart' as bbcard_manager;
import 'bulletin_board_card_selection_controller.dart' as bbcard_selection;

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

typedef BulletinBoardCardFSMType
    = fsm_core.NonDeterministicFSM<BulletinBoardCardFSMStateName>;

typedef BulletinBoardCardFSMStateResolverType
    = fsm_core.FSMStateResolver<BulletinBoardCardFSMStateName>;

class BulletinBoardCardFSMStateBase implements BulletinBoardCardFSMState {
  const BulletinBoardCardFSMStateBase(
      final BulletinBoardCardID associatedCardID,
      final BulletinBoardCardFSMStateName name,
      final BulletinBoardCardFSMType ownerFSM,
      final BulletinBoardCardFSMStateResolverType stateResolver)
      : _associatedCardID = associatedCardID,
        _stateName = name,
        _ownerFSM = ownerFSM,
        _stateResolver = stateResolver;

  @override
  BulletinBoardCardFSMStateName getStateName() {
    return _stateName;
  }

  @override
  void onCardDeletionRequested() {
    _ownerFSM.transit(fsm_core.FSMSimpleTransition(_stateResolver),
        BulletinBoardCardFSMStateName.deleting);
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

  final BulletinBoardCardID _associatedCardID;
  final BulletinBoardCardFSMStateName _stateName;
  final BulletinBoardCardFSMType _ownerFSM;
  final BulletinBoardCardFSMStateResolverType _stateResolver;
}

class BulletinBoardCardIdleFSMState extends BulletinBoardCardFSMStateBase {
  const BulletinBoardCardIdleFSMState(
      final BulletinBoardCardID associatedCardID,
      final BulletinBoardCardFSMType ownerFSM,
      final BulletinBoardCardFSMStateResolverType stateResolver)
      : super(associatedCardID, BulletinBoardCardFSMStateName.idle, ownerFSM,
            stateResolver);

  @override
  void onPointerDownOnCard(PointerDownEvent pointerDownEvent) {
    super.onPointerDownOnCard(pointerDownEvent);

    // We need to go to the selected state, because the pointer is
    // down on this specified card.
    _ownerFSM.transit(fsm_core.FSMSimpleTransition(_stateResolver),
        BulletinBoardCardFSMStateName.selected);
  }
}

class BulletinBoardCardSelectedFSMState extends BulletinBoardCardFSMStateBase {
  const BulletinBoardCardSelectedFSMState(
      final BulletinBoardCardID associatedCardID,
      final bbcard_selection.BulletinBoardCardSafeSelectionController
          selectionController,
      final BulletinBoardCardFSMType ownerFSM,
      final BulletinBoardCardFSMStateResolverType stateResolver)
      : _selectionController = selectionController,
        super(associatedCardID, BulletinBoardCardFSMStateName.selected,
            ownerFSM, stateResolver);

  @override
  void onStateEnter() {
    super.onStateEnter();

    _setSelectionState(true);
  }

  @override
  void onStateLeave() {
    super.onStateLeave();

    _setSelectionState(false);
  }

  @override
  void onCardFocusChanged(bool bHasFocus) {
    super.onCardFocusChanged(bHasFocus);

    if (bHasFocus) {
      // We should be here only when the card has focus because
      // when it loses the focus the card should be in editing state.
      _ownerFSM.transit(fsm_core.FSMSimpleTransition(_stateResolver),
          BulletinBoardCardFSMStateName.editing);
    }
  }

  @override
  void onPointerDownOnCard(PointerDownEvent pointerDownEvent) {
    super.onPointerDownOnCard(pointerDownEvent);
    _setSelectionState(true);
  }

  void _setSelectionState(final bool bSelected) {
    if (bSelected) {
      _selectionController.safeSetCardSelectionStateAndLock(
          _associatedCardID, bSelected);
    } else {
      _selectionController.safeSetCardSelectionStateOrSinkLock(
          _associatedCardID, bSelected);
    }
  }

  final bbcard_selection.BulletinBoardCardSafeSelectionController
      _selectionController;
}

class BulletinBoardCardEditingFSMState extends BulletinBoardCardFSMStateBase {
  BulletinBoardCardEditingFSMState(
      final BulletinBoardCardID associatedCardID,
      final bbcard_selection.BulletinBoardCardSafeSelectionController
          selectionController,
      final BulletinBoardCardFSMType ownerFSM,
      final BulletinBoardCardFSMStateResolverType stateResolver)
      : _selectionController = selectionController,
        super(associatedCardID, BulletinBoardCardFSMStateName.editing, ownerFSM,
            stateResolver);

  @override
  void onStateEnter() {
    super.onStateEnter();

    // We don't want the card to be selected in editing mode, otherwise
    // the user cannot select the text within it.
    _selectionController.safeSetCardSelectionState(_associatedCardID, false);
    assert(!bbcard_selection.BulletinBoardCardSelectionUtils.isCardSelected(
        _associatedCardID, _selectionController));
  }

  @override
  void onStateLeave() {
    super.onStateLeave();
    assert(!bbcard_selection.BulletinBoardCardSelectionUtils.isCardSelected(
        _associatedCardID, _selectionController));

    _bPointerDownOnCard = false;
  }

  @override
  void onCardFocusChanged(bool bHasFocus) {
    super.onCardFocusChanged(bHasFocus);

    if (bHasFocus) {
      // Stay in this state.
      _bPointerDownOnCard = false;
      return;
    }

    if (_bPointerDownOnCard) {
      _ownerFSM.transit(fsm_core.FSMSimpleTransition(_stateResolver),
          BulletinBoardCardFSMStateName.selected);
    } else {
      _ownerFSM.transit(fsm_core.FSMSimpleTransition(_stateResolver),
          BulletinBoardCardFSMStateName.idle);
    }

    _bPointerDownOnCard = false;
  }

  @override
  void onPointerDownOnCard(PointerDownEvent pointerDownEvent) {
    super.onPointerDownOnCard(pointerDownEvent);

    _bPointerDownOnCard = true;
  }

  bool _bPointerDownOnCard = false;

  final bbcard_selection.BulletinBoardCardSafeSelectionController
      _selectionController;
}

class BulletinBoardCardDeletingFSMState extends BulletinBoardCardFSMStateBase {
  const BulletinBoardCardDeletingFSMState(
      final bbcard_manager.BulletinBoardCardsManager cardsManager,
      final BulletinBoardCardID associatedCardID,
      final BulletinBoardCardFSMType ownerFSM,
      final BulletinBoardCardFSMStateResolverType stateResolver)
      : _cardsManager = cardsManager,
        super(associatedCardID, BulletinBoardCardFSMStateName.deleting,
            ownerFSM, stateResolver);

  @override
  void onStateEnter() {
    super.onStateEnter();

    // Here we delete the card and we fire the event back up to
    // the bulletin board so it can update the displayed cards.
    _cardsManager.deleteCard(_associatedCardID);
  }

  @override
  void onCardDeletionRequested() {
    // We must stay in this state, we don't have to
    // call the parent implementation.
  }

  final bbcard_manager.BulletinBoardCardsManager _cardsManager;
}

abstract class BulletinBoardCardFiniteStateMachine
    extends BulletinBoardCardFSMType {
  BulletinBoardCardFiniteStateMachine()
      : super(fsm_core.DeferredInitializationFSMState());

  void initialize(BulletinBoardCardID associatedCardID);

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

  static bool isInDeletingState(BulletinBoardCardFSMType fsm) {
    return fsm.getCurrentStateName() == BulletinBoardCardFSMStateName.deleting;
  }
}

typedef BulletinBoardCardFSMStates
    = Map<BulletinBoardCardFSMStateName, BulletinBoardCardFSMState>;

class BulletinBoardCardNonDeterministicFSM
    extends BulletinBoardCardFiniteStateMachine
    implements BulletinBoardCardFSMStateResolverType {
  BulletinBoardCardNonDeterministicFSM(
      final bbcard_manager.BulletinBoardCardsManager cardsManager,
      final bbcard_selection.BulletinBoardCardSafeSelectionController
          selectionController)
      : _cardsManager = cardsManager,
        _selectionController = selectionController,
        super();

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
  void initialize(BulletinBoardCardID associatedCardID) {
    // Before going to the initial state we need to allocate all the states
    // for this card.
    _fsmStates = {
      BulletinBoardCardFSMStateName.idle:
          BulletinBoardCardIdleFSMState(associatedCardID, this, this),
      BulletinBoardCardFSMStateName.selected: BulletinBoardCardSelectedFSMState(
          associatedCardID, _selectionController, this, this),
      BulletinBoardCardFSMStateName.editing: BulletinBoardCardEditingFSMState(
          associatedCardID, _selectionController, this, this),
      BulletinBoardCardFSMStateName.deleting: BulletinBoardCardDeletingFSMState(
          _cardsManager, associatedCardID, this, this)
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

  final bbcard_manager.BulletinBoardCardsManager _cardsManager;
  final bbcard_selection.BulletinBoardCardSafeSelectionController
      _selectionController;

  BulletinBoardCardFSMStates _fsmStates = {};
}
