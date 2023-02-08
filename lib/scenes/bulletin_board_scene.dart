// Copyright (C) 2023 Andrea Ballestrazzi

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
  @override
  Widget build(Object context) {
    return MouseRegion(
      onHover: _onMouseHover,
      child: BulletinBoardScenePresentation(onCardAddEvent: _onCardAddEvent),
    );
  }

  void _onCardAddEvent() {}

  void _onMouseHover(PointerHoverEvent pointerHoverEvent) {}

}
