// Copyright (C) 2023 Andrea Ballestrazzi

import 'package:astali/input-management/pointer_events.dart';

// Core and engine
import 'package:flutter/material.dart';
import 'dart:math';

typedef OnDescriptionTextChanged = void Function(String);

class BulletinBoardCardPresentation extends StatelessWidget {
  static const double cardWidth = 200.0;
  static const double cardHeight = 200.0;
  static const double cardTitleFontSize = 16.0;
  static const double cardDescriptionFontSize = 14.0;

  const BulletinBoardCardPresentation(
      {required this.cardPosition,
      required this.onPointerDownEvent,
      super.key});

  final MousePoint cardPosition;
  final OnPointerDownEvent onPointerDownEvent;

  TextField _createTitleTextField(BuildContext context, final double fontSize) {
    return const TextField(
      decoration: InputDecoration(hintText: "Title"),
      style: TextStyle(
        fontSize: 16,
        fontWeight: FontWeight.bold,
      ),
      textInputAction: TextInputAction.next,
    );
  }

  TextField _createDescriptionTextField(
      BuildContext context, final double fontSize) {
    return const TextField(
        decoration: InputDecoration(
          hintText: "Description",
          border: InputBorder.none,
        ),
        keyboardType: TextInputType.multiline,
        style: TextStyle(
          fontSize: 14,
        ),
        textInputAction: TextInputAction.newline,
        minLines: 1,
        maxLines: 5);
  }

  Widget _createCardMainBodyLayout(BuildContext context) {
    return Column(
        crossAxisAlignment: CrossAxisAlignment.center,
        mainAxisAlignment: MainAxisAlignment.start,
        children: [
          Padding(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
              child: _createTitleTextField(context, cardTitleFontSize)),
          Padding(
              padding: const EdgeInsets.symmetric(horizontal: 8),
              child:
                  _createDescriptionTextField(context, cardDescriptionFontSize))
        ]);
  }

  Card _createMainCardBody(BuildContext context, final Color cardColor) {
    return Card(
        shadowColor: Colors.black,
        color: cardColor,
        child: _createCardMainBodyLayout(context));
  }

  SizedBox _createCardSizedBox(
      BuildContext context, final double width, final double height) {
    return SizedBox(
        width: width,
        height: height,
        child: _createMainCardBody(context, Colors.yellow[200]!));
  }

  Listener _createPointerListenerArea(BuildContext context) {
    return Listener(
        onPointerDown: onPointerDownEvent,
        child: _createCardSizedBox(context, cardWidth, cardHeight));
  }

  Positioned _createPositionableArea(BuildContext context) {
    return Positioned(
        top: cardPosition.y,
        left: cardPosition.x,
        child: _createPointerListenerArea(context));
  }

  Widget _createCard(BuildContext context) {
    return Stack(children: <Widget>[_createPositionableArea(context)]);
  }

  @override
  Widget build(BuildContext context) {
    return _createCard(context);
  }
}

class BulletinBoardCard extends StatefulWidget {
  const BulletinBoardCard({required this.cardPosition, super.key});

  final Point<double> cardPosition;

  @override
  State<BulletinBoardCard> createState() => _BulletinBoardCardState();
}

class _BulletinBoardCardState extends State<BulletinBoardCard> {
  void _onPointerDownOnCard(PointerDownEvent pointerDownEvent) {
    print("Pointer down");
  }

  @override
  Widget build(BuildContext context) {
    return BulletinBoardCardPresentation(
        onPointerDownEvent: _onPointerDownOnCard,
        cardPosition: widget.cardPosition);
  }
}
