// Copyright (C) 2023 Andrea Ballestrazzi

import 'package:astali/fsm/finite_state_machine.dart';
import 'package:astali/fsm/fsm_transition.dart';

import 'finite-state-machines/bulletin_board_fsm.dart';

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';

typedef OnCardAddEvent = VoidCallback;

class BulletinBoardScenePresentation extends StatelessWidget {
  const BulletinBoardScenePresentation({required this.onCardAddEvent, super.key});

  final OnCardAddEvent onCardAddEvent;

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
      onPointerMove: _onMouseHover,
      child: BulletinBoardScenePresentation(onCardAddEvent: _onCardAddEvent),
    );
  }

  void _onCardAddEvent() {
    _bulletinBoardFSM!.transit(FSMSimpleTransition(_bulletinBoardFSMResolver), BulletinBoardFSMStateName.creatingCard);
  }

  void _onMouseHover(PointerMoveEvent pointerHoverEvent) {}

}
