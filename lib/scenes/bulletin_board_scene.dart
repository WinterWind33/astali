// Copyright (C) 2023 Andrea Ballestrazzi

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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      floatingActionButton: _createAddCardButton(),
    );
  }
}
