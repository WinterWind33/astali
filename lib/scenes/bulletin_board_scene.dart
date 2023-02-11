// Copyright (C) 2023 Andrea Ballestrazzi

// Astali cards
import 'package:astali/cards-management/user-interface/cards/bulletin_board_card.dart';

// FSM
import 'package:astali/fsm/finite_state_machine.dart';
import 'package:astali/fsm/fsm_transition.dart';
import 'finite-state-machines/bulletin_board_fsm.dart';

// Core and engine
import 'dart:math';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';

typedef OnCardAddEvent = VoidCallback;
typedef OnPointerHoverEvent = void Function(PointerHoverEvent);
typedef OnPointerUpEvent = void Function(PointerUpEvent);
typedef OnPointerDownEvent = void Function(PointerDownEvent);

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
  final BulletinBoardFSMStateResolver _bulletinBoardFSMResolver = BulletinBoardFSMStateResolver();
  BulletinBoardNonDeterministicFSM? _bulletinBoardFSM;

  final List<BulletinBoardCard> _bulletinCards = List<BulletinBoardCard>.empty(growable: true);

  BulletinBoardScenePointerEvents? _pointerEvents;
  Point<double> _currentMousePos = const Point<double>(0.0, 0.0);

  @override
  void initState() {
    super.initState();

    _bulletinBoardFSM = BulletinBoardNonDeterministicFSM(_bulletinBoardFSMResolver.getState(BulletinBoardFSMStateName.idle));
    _pointerEvents = BulletinBoardScenePointerEvents(
      onPointerHoverEvent: _onMouseHover,
      onPointerUpEvent: _onMouseUp,
      onPointerDownEvent: _onPointerDown);
  }

  @override
  void dispose() {
    // We need the board to go to the idle state before being disposed.
    _bulletinBoardFSM!.transit(FSMSimpleTransition(_bulletinBoardFSMResolver), BulletinBoardFSMStateName.idle);
    super.dispose();
  }

  @override
  Widget build(Object context) {
    return BulletinBoardScenePresentation(
        pointerEvents: _pointerEvents!,
        onCardAddEvent: _onCardAddEvent,
        cardsToRender: _bulletinCards);
  }

  void _onCardAddEvent() {
    if(!isInState(_bulletinBoardFSM!, BulletinBoardFSMStateName.idle)) {
      // The previous card was spawning and the user didn't confirm it. We can
      // erase that card.
      // The card is always the last inside this list.
      _bulletinCards.removeLast();
    }

    _bulletinBoardFSM!.transit(FSMSimpleTransition(_bulletinBoardFSMResolver), BulletinBoardFSMStateName.creatingCard);

    setState(() {
      _bulletinCards.add(BulletinBoardCard(cardPosition: _currentMousePos));
    });
  }

  void _onMouseHover(PointerHoverEvent pointerHoverEvent) {
    // We retrieve the mouse position independently from the current FSM state.
    final Offset localPosition = pointerHoverEvent.localPosition;
    _currentMousePos = Point<double>(localPosition.dx, localPosition.dy);

    if(isInState(_bulletinBoardFSM!, BulletinBoardFSMStateName.creatingCard)) {
      setState(() {
          _bulletinCards.last = BulletinBoardCard(cardPosition: _currentMousePos);
        }
      );
    }
  }

  void _onPointerDown(PointerDownEvent pointerDownEvent) {
    if(pointerDownEvent.buttons == kSecondaryMouseButton &&
      isInState(_bulletinBoardFSM!, BulletinBoardFSMStateName.creatingCard)) {
      // The user requested to cancel the card creation.
      _bulletinBoardFSM!.transit(FSMSimpleTransition(_bulletinBoardFSMResolver), BulletinBoardFSMStateName.idle);

      setState(() {
        _bulletinCards.removeLast();
      });
    }
  }

  void _onMouseUp(PointerUpEvent pointerUpEvent) {
    if(isInState(_bulletinBoardFSM!, BulletinBoardFSMStateName.creatingCard)) {
      _bulletinBoardFSM!.transit(FSMSimpleTransition(_bulletinBoardFSMResolver), BulletinBoardFSMStateName.idle);

      setState(() {
        _bulletinCards.last = BulletinBoardCard(cardPosition: _currentMousePos);
      });
    }
  }
}
