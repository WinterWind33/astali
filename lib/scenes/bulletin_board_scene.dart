// Copyright (C) 2023 Andrea Ballestrazzi

// Astali cards
import 'package:astali/cards-management/user-interface/cards/bulletin_board_card.dart';
import 'package:astali/input-management/pointer_events.dart';

// FSM
import 'finite-state-machines/bulletin_board_fsm.dart';

// Core and engine
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';

typedef OnCardAddEvent = VoidCallback;

/// Rerepresents a set of pointer callbacks used within
/// the bulletin board scene.
class BulletinBoardScenePointerEvents {
  const BulletinBoardScenePointerEvents({
    required this.onPointerHoverEvent,
    required this.onPointerUpEvent,
    required this.onPointerDownEvent
  });

  final OnPointerHoverEvent onPointerHoverEvent;
  final OnPointerUpEvent onPointerUpEvent;
  final OnPointerDownEvent onPointerDownEvent;
}

class BulletinBoardScenePresentation extends StatelessWidget {
  const BulletinBoardScenePresentation({
    required this.pointerEvents,
    required this.onCardAddEvent,
    required this.cardsToRender,
    super.key
  });

  final BulletinBoardScenePointerEvents pointerEvents;
  final OnCardAddEvent onCardAddEvent;
  final List<BulletinBoardCard> cardsToRender;

  FloatingActionButton _createAddCardButton() {
    return FloatingActionButton(
      onPressed: onCardAddEvent,
      tooltip: "Add a card",
      child: const Icon(Icons.add),
    );
  }

  Widget _createBody() {
    return Listener(
      onPointerHover: pointerEvents.onPointerHoverEvent,
      onPointerUp: pointerEvents.onPointerUpEvent,
      onPointerDown: pointerEvents.onPointerDownEvent,
      child: Container(
        color: const Color.fromARGB(255, 156, 111, 62),
        child: Stack(
          children: cardsToRender,
        )
      )
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      floatingActionButton: _createAddCardButton(),
      body: _createBody(),
    );
  }
}

class BulletinBoardScene extends StatefulWidget {
  const BulletinBoardScene({super.key});

  @override
  State<BulletinBoardScene> createState() => _BulletinBoardState();
}

class _BulletinBoardState extends State<BulletinBoardScene> {
  final BulletinBoardNonDeterministicFSM _bulletinBoardFSM = BulletinBoardNonDeterministicFSM();
  final List<BulletinBoardCard> _bulletinCards = List<BulletinBoardCard>.empty(growable: true);

  BulletinBoardScenePointerEvents? _pointerEvents;
  MousePoint _currentMousePos = const MousePoint(0.0, 0.0);

  @override
  void initState() {
    super.initState();

    _pointerEvents = BulletinBoardScenePointerEvents(
      onPointerHoverEvent: _onMouseHover,
      onPointerUpEvent: _onMouseUp,
      onPointerDownEvent: _onPointerDown);

    _bulletinBoardFSM.initialize(_bulletinCards);
  }

  @override
  void dispose() {
    // We need the board to go to the idle state before being disposed.
    _bulletinBoardFSM.transitToIdleMode();
    super.dispose();
  }

  @override
  Widget build(Object context) {
    return BulletinBoardScenePresentation(
        pointerEvents: _pointerEvents!,
        onCardAddEvent: _onCardAddEvent,
        cardsToRender: _bulletinCards);
  }

  void _removeCreatingCard() {
    _bulletinCards.removeLast();
  }

  void _updateCreatingCard(MousePoint newPoint) {
    _bulletinCards.last = BulletinBoardCard(cardPosition: newPoint);
  }

  void _onCardAddEvent() {
    if(!_bulletinBoardFSM.isInIdleMode()) {
      // The previous card was spawning and the user didn't confirm it. We can
      // erase that card.
      // The card is always the last inside this list.
      _removeCreatingCard();
    }

    _bulletinBoardFSM.transitToCreatingCardMode();

    setState(() {
      _bulletinCards.add(BulletinBoardCard(cardPosition: _currentMousePos));
    });
  }

  void _onMouseHover(PointerHoverEvent pointerHoverEvent) {
    // We retrieve the mouse position independently from the current FSM state.
    final Offset localPosition = pointerHoverEvent.localPosition;
    _currentMousePos = MousePoint(localPosition.dx, localPosition.dy);

    if(_bulletinBoardFSM.isInCreatingCardMode()) {
      setState(() {
          _updateCreatingCard(_currentMousePos);
        }
      );
    }
  }

  void _onPointerDown(PointerDownEvent pointerDownEvent) {
    if(isRightMouseButton(pointerDownEvent.buttons) && _bulletinBoardFSM.isInCreatingCardMode()) {
      // The user requested to cancel the card creation.
      _bulletinBoardFSM.transitToIdleMode();

      setState(() {
        _removeCreatingCard();
      });
    }
  }

  void _onMouseUp(PointerUpEvent pointerUpEvent) {
    if(_bulletinBoardFSM.isInCreatingCardMode()) {
      _bulletinBoardFSM.transitToIdleMode();

      setState(() {
        _updateCreatingCard(_currentMousePos);
      });
    }
  }
}
