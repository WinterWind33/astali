// Copyright (C) 2023 Andrea Ballestrazzi

import 'dart:math';

import 'package:astali/cards-management/user-interface/cards/astali_card.dart';
import 'package:astali/fsm/finite_state_machine.dart';

import 'package:astali/fsm/fsm_transition.dart';
import 'package:flutter/gestures.dart';
import 'finite-state-machines/bulletin_board_fsm.dart';

import 'package:flutter/material.dart';

typedef OnCardAddEvent = VoidCallback;

class BulletinBoardScenePresentation extends StatelessWidget {
  const BulletinBoardScenePresentation({
    required this.onCardAddEvent,
    required this.cardsToRender,
    super.key
  });

  final OnCardAddEvent onCardAddEvent;
  final List<AstaliCard> cardsToRender;

  FloatingActionButton _createAddCardButton() {
    return FloatingActionButton(
      onPressed: onCardAddEvent,
      tooltip: "Add a card",
      child: const Icon(Icons.add),
    );
  }

  Widget _createBody() {
    return Container(
        color: const Color.fromARGB(255, 156, 111, 62),
        child: Stack(
          children: cardsToRender,
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

  final List<AstaliCard> _bulletinCards = List<AstaliCard>.empty(growable: true);
  Point<double> _currentMousePos = Point<double>(0.0, 0.0);

  @override
  void initState() {
    super.initState();

    _bulletinBoardFSM = BulletinBoardNonDeterministicFSM(_bulletinBoardFSMResolver.getState(BulletinBoardFSMStateName.idle));
  }

  @override
  void dispose() {
    // We need the board to go to the idle state before being disposed.
    _bulletinBoardFSM!.transit(FSMSimpleTransition(_bulletinBoardFSMResolver), BulletinBoardFSMStateName.idle);
    super.dispose();
  }

  @override
  Widget build(Object context) {
    return Listener(
      onPointerHover: _onMouseHover,
      child: BulletinBoardScenePresentation(
        onCardAddEvent: _onCardAddEvent,
        cardsToRender: _bulletinCards),
    );
  }

  void _onCardAddEvent() {
    if(isInState(_bulletinBoardFSM!, BulletinBoardFSMStateName.creatingCard)) {
      // The previous card was spawning and the user didn't confirm it. We can
      // erase that card.
      // The card is always the last inside this list.
      _bulletinCards.removeLast();
    }

    _bulletinBoardFSM!.transit(FSMSimpleTransition(_bulletinBoardFSMResolver), BulletinBoardFSMStateName.creatingCard);

    setState(() {
      _bulletinCards.add(AstaliCard(cardPosition: _currentMousePos));
    });
  }

  void _onMouseHover(PointerHoverEvent pointerHoverEvent) {
    // We retrieve the mouse position independently from the current FSM state.
    final Offset localPosition = pointerHoverEvent.localPosition;
    _currentMousePos = Point<double>(localPosition.dx, localPosition.dy);

    if(isInState(_bulletinBoardFSM!, BulletinBoardFSMStateName.creatingCard)) {
      setState(() {
          _bulletinCards.last = AstaliCard(cardPosition: _currentMousePos);
        }
      );
    }
  }

}
