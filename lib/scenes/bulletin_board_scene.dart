// Copyright (C) 2023 Andrea Ballestrazzi

import 'package:flutter/material.dart';

typedef OnCardAddEvent = VoidCallback;

class BulletinBoardScene extends StatelessWidget {
  const BulletinBoardScene({required this.onCardAddEvent, super.key});

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
