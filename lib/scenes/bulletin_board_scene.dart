// Copyright (C) 2023 Andrea Ballestrazzi

// Astali cards
import 'package:astali/cards-management/bulletin-board-cards/bulletin_board_card_selection_controller.dart';
import 'package:astali/cards-management/bulletin-board-cards/bulletin_board_card_id.dart';
import 'package:astali/cards-management/bulletin-board-cards/bulletin_board_cards_manager.dart';
import 'package:astali/cards-management/bulletin-board-cards/presentation/bulletin_board_card.dart';
import 'package:astali/input-management/pointer_events.dart';

// FSM
import 'finite-state-machines/bulletin_board_fsm.dart';
import 'package:astali/fsm/finite_state_machine.dart';

// Core and engine
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';

typedef OnCardAddEvent = VoidCallback;

/// Rerepresents a set of pointer callbacks used within
/// the bulletin board scene.
class BulletinBoardScenePointerEvents {
  const BulletinBoardScenePointerEvents(
      {required this.onPointerHoverEvent,
      required this.onPointerUpEvent,
      required this.onPointerDownEvent});

  final OnPointerHoverEvent onPointerHoverEvent;
  final OnPointerUpEvent onPointerUpEvent;
  final OnPointerDownEvent onPointerDownEvent;
}

class BulletinBoardScenePresentation extends StatelessWidget {
  const BulletinBoardScenePresentation(
      {required this.pointerEvents,
      required this.onCardAddEvent,
      required this.cardsToRender,
      super.key});

  final BulletinBoardScenePointerEvents pointerEvents;
  final OnCardAddEvent onCardAddEvent;
  final BulletinBoardCards cardsToRender;

  FloatingActionButton _createAddCardButton() {
    return FloatingActionButton(
      onPressed: onCardAddEvent,
      tooltip: "Add a card",
      child: const Icon(Icons.add),
    );
  }

  Widget _createBody() {
    var list = cardsToRender.values.toList();
    return Listener(
        onPointerHover: pointerEvents.onPointerHoverEvent,
        onPointerUp: pointerEvents.onPointerUpEvent,
        onPointerDown: pointerEvents.onPointerDownEvent,
        child: Container(
            color: const Color.fromARGB(255, 156, 111, 62),
            child: Stack(
              children: list,
            )));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      floatingActionButton: _createAddCardButton(),
      body: _createBody(),
    );
  }
}

typedef OnBulletinBoardCardManagerAddCardEvent = void Function(
    BulletinBoardCard);

typedef OnBulletinBoardCardManagerDeleteCardEvent = void Function(
    BulletinBoardCardID);

class BulletinBoardScene extends StatefulWidget {
  const BulletinBoardScene({super.key});

  @override
  State<BulletinBoardScene> createState() => _BulletinBoardState();
}

class BulletinBoardCardsManagerDelegator
    implements BulletinBoardCardsManagerEventListener {
  BulletinBoardCardsManagerDelegator(
      {this.onAddCardDelegate, this.onDeleteDelegate});

  @override
  void onCardAdded(BulletinBoardCard newCard) {
    if (onAddCardDelegate != null) {
      onAddCardDelegate!(newCard);
    }
  }

  @override
  void onCardDeleted(BulletinBoardCardID oldCardID) {
    if (onDeleteDelegate != null) {
      onDeleteDelegate!(oldCardID);
    }
  }

  OnBulletinBoardCardManagerDeleteCardEvent? onDeleteDelegate;
  OnBulletinBoardCardManagerAddCardEvent? onAddCardDelegate;
}

class _BulletinBoardState extends State<BulletinBoardScene> {
  /// Managers

  final BulletinBoardCardIDGenerator _bulletinBoardCardsIDsGenerator =
      BulletinBoardCardIDSimpleGenerator();
  final BulletinBoardCardsManager _bulletinBoardCardsManager =
      BulletinBoardCardsManagerImpl();
  final BulletinBoardCardSafeSelectionController _safeSelectionController =
      BulletinBoardCardSafeSelectionControllerImpl();

  BulletinBoardNonDeterministicFSM? _bulletinBoardFSM;
  BulletinBoardFSMEventDispatcher? _fsmEventHandler;
  BulletinBoardScenePointerEvents? _pointerEvents;

  @override
  void initState() {
    super.initState();

    _bulletinBoardCardsManager.registerEventListener(
        BulletinBoardCardsManagerDelegator(
            onDeleteDelegate: _onCardDeletedEvent));

    _bulletinBoardFSM = BulletinBoardNonDeterministicFSM(
        _bulletinBoardCardsIDsGenerator, _safeSelectionController);

    _pointerEvents = BulletinBoardScenePointerEvents(
        onPointerHoverEvent: _onMouseHover,
        onPointerUpEvent: _onMouseUp,
        onPointerDownEvent: _onPointerDown);

    _bulletinBoardFSM!.initialize(_bulletinBoardCardsManager);
    _fsmEventHandler = BulletinBoardFSMEventDispatcher(_bulletinBoardFSM!);
  }

  @override
  void dispose() {
    // We need the board to go to the idle state before being disposed.
    _bulletinBoardFSM!.teardown();
    super.dispose();
  }

  @override
  Widget build(Object context) {
    return BulletinBoardScenePresentation(
        pointerEvents: _pointerEvents!,
        onCardAddEvent: _onCardAddEvent,
        cardsToRender: _bulletinBoardCardsManager.getBulletinBoardCards());
  }

  void _onCardAddEvent() {
    setState(() {
      _fsmEventHandler!.processOnAddCardEvent();
    });
  }

  void _onCardDeletedEvent(BulletinBoardCardID cardID) {
    setState(() {});
  }

  void _onMouseHover(PointerHoverEvent pointerHoverEvent) {
    if (isInState(_bulletinBoardFSM!, BulletinBoardFSMStateName.idle)) {
      _fsmEventHandler!.processOnPointerHoverEvent(pointerHoverEvent);
    } else {
      setState(() {
        _fsmEventHandler!.processOnPointerHoverEvent(pointerHoverEvent);
      });
    }
  }

  void _onPointerDown(PointerDownEvent pointerDownEvent) {
    setState(() {
      _fsmEventHandler!.processOnPointerDownEvent(pointerDownEvent);
    });
  }

  void _onMouseUp(PointerUpEvent pointerUpEvent) {
    setState(() {
      _fsmEventHandler!.processOnPointerUpEvent(pointerUpEvent);
    });
  }
}
