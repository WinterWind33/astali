// Copyright (C) 2023 Andrea Ballestrazzi

import 'package:astali/cards-management/bulletin-board-cards/bulletin_board_card_id.dart';
import 'package:astali/cards-management/bulletin-board-cards/bulletin_board_card_fsm.dart'
    as bbcard_fsm;
import 'package:astali/input-management/pointer_events.dart';

// Core and engine
import 'package:flutter/material.dart';
import 'dart:math';

typedef OnCardFocusChanged = void Function(bool);
typedef OnCardDeleteEventInternal = VoidCallback;

typedef OnCardTitleChanged = void Function(String);
typedef OnCardDescriptionChanged = void Function(String);

class BulletinBoardCardPresentation extends StatelessWidget {
  static const double cardWidth = 200.0;
  static const double cardHeight = 200.0;
  static const double cardTitleFontSize = 16.0;
  static const double cardDescriptionFontSize = 14.0;

  const BulletinBoardCardPresentation(
      {required this.cardPosition,
      required this.onCardFocusChanged,
      required this.onPointerUpEvent,
      required this.onPointerDownEvent,
      required this.onCardDeleteEventInternal,
      required this.bSelected,
      required this.onCardTitleChanged,
      required this.onCardDescriptionChanged,
      this.initialTitle = "",
      this.initialDescription = "",
      super.key});

  final MousePoint cardPosition;
  final OnCardFocusChanged onCardFocusChanged;
  final OnPointerUpEvent onPointerUpEvent;
  final OnPointerDownEvent onPointerDownEvent;
  final OnCardDeleteEventInternal onCardDeleteEventInternal;
  final bool bSelected;
  final String initialTitle;
  final String initialDescription;
  final OnCardTitleChanged onCardTitleChanged;
  final OnCardDescriptionChanged onCardDescriptionChanged;

  TextField _createTitleTextField(BuildContext context, final double fontSize) {
    return TextField(
      decoration: const InputDecoration(hintText: "Title"),
      style: const TextStyle(
        fontSize: 16,
        fontWeight: FontWeight.bold,
      ),
      textInputAction: TextInputAction.next,
      controller: TextEditingController(text: initialTitle),
      onChanged: onCardTitleChanged,
    );
  }

  TextField _createDescriptionTextField(
      BuildContext context, final double fontSize) {
    return TextField(
        decoration: const InputDecoration(
          hintText: "Description",
          border: InputBorder.none,
        ),
        keyboardType: TextInputType.multiline,
        style: const TextStyle(
          fontSize: 14,
        ),
        textInputAction: TextInputAction.newline,
        controller: TextEditingController(text: initialDescription),
        onChanged: onCardDescriptionChanged,
        minLines: 1,
        maxLines: 4);
  }

  Widget _createDeleteCardButton(BuildContext context) {
    return IconButton(
        onPressed: onCardDeleteEventInternal,
        icon: const Icon(Icons.delete),
        color: Colors.red[800],
        splashColor: Colors.grey[400],
        hoverColor: Colors.grey[300],
        splashRadius: 20.0,
        iconSize: 20.0);
  }

  Widget _createCardMainBodyLayout(BuildContext context) {
    return Column(
        crossAxisAlignment: CrossAxisAlignment.center,
        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
        children: [
          Padding(
              padding: const EdgeInsets.symmetric(horizontal: 6),
              child: _createTitleTextField(context, cardTitleFontSize)),
          Padding(
              padding: const EdgeInsets.symmetric(horizontal: 6),
              child: _createDescriptionTextField(
                  context, cardDescriptionFontSize)),
          Padding(
              padding: const EdgeInsets.only(left: 6, right: 6, top: 8),
              child: Align(
                  alignment: Alignment.bottomRight,
                  child: _createDeleteCardButton(context)))
        ]);
  }

  Card _createMainCardBody(BuildContext context, final Color cardColor) {
    ShapeBorder? cardShapeBorder;

    // If this card is selected or has focus, we tint the outline border
    // of another color. We do this by setting the card shape border.
    if (bSelected) {
      cardShapeBorder = RoundedRectangleBorder(
          side: BorderSide(color: Colors.blue[600]!, width: 2.0),
          borderRadius: const BorderRadius.all(Radius.circular(12.0)));
    }

    return Card(
        shadowColor: Colors.black,
        color: cardColor,
        shape: cardShapeBorder,
        child: _createCardMainBodyLayout(context));
  }

  SizedBox _createCardSizedBox(
      BuildContext context, final double width, final double height) {
    return SizedBox(
        width: width,
        height: height,
        child: _createMainCardBody(context, Colors.yellow[200]!));
  }

  Widget _createEventSensitiveArea(BuildContext context) {
    return Listener(
        onPointerUp: onPointerUpEvent,
        onPointerDown: onPointerDownEvent,
        child: Focus(
            onFocusChange: (bHasFocus) {
              onCardFocusChanged(bHasFocus);
            },
            child: _createCardSizedBox(context, cardWidth, cardHeight)));
  }

  Positioned _createPositionableArea(BuildContext context) {
    return Positioned(
        top: cardPosition.y,
        left: cardPosition.x,
        child: _createEventSensitiveArea(context));
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
  const BulletinBoardCard(
      {required this.cardPosition,
      required this.cardFSM,
      this.initialTitle = "",
      this.initialDescription = "",
      super.key});

  final bbcard_fsm.BulletinBoardCardFiniteStateMachine cardFSM;
  final Point<double> cardPosition;
  final String initialTitle;
  final String initialDescription;

  @override
  State<BulletinBoardCard> createState() => _BulletinBoardCardState();
}

class _BulletinBoardCardState extends State<BulletinBoardCard> {
  BulletinBoardCardID? _bulletinBoardCardId;
  bbcard_fsm.BulletinBoardCardFiniteStateMachine? _cardFSM;

  String _title = "";
  String _description = "";

  @override
  void initState() {
    super.initState();
    assert(widget.key != null);
    _bulletinBoardCardId = BulletinBoardCardKey.retrieveIDFromKey(widget.key!);
    _cardFSM = widget.cardFSM;
    _cardFSM!.initialize(_bulletinBoardCardId!);

    _title = widget.initialTitle;
    _description = widget.initialDescription;
  }

  @override
  void dispose() {
    super.dispose();
  }

  void _onPointerUpOnCard(PointerUpEvent pointerUpEvent) {
    _getCurrentFSMState().onPointerUpOnCard(pointerUpEvent);
  }

  void _onPointerDownOnCard(PointerDownEvent pointerDownEvent) {
    _getCurrentFSMState().onPointerDownOnCard(pointerDownEvent);
  }

  void _onCardFocusChanged(final bool bHasFocus) {
    setState(() {
      _getCurrentFSMState().onCardFocusChanged(bHasFocus);
    });
  }

  void _onCardDeleteButtonEvent() {
    _getCurrentFSMState().onCardDeletionRequested();
  }

  void _onCardTitleChanged(String text) {
    _title = text;
    _getCurrentFSMState().onCardTitleChanged(text);
  }

  void _onCardDesriptionChanged(String text) {
    _description = text;
    _getCurrentFSMState().onCardDescriptionChanged(text);
  }

  @override
  Widget build(BuildContext context) {
    return BulletinBoardCardPresentation(
      onCardFocusChanged: _onCardFocusChanged,
      onPointerUpEvent: _onPointerUpOnCard,
      onPointerDownEvent: _onPointerDownOnCard,
      onCardDeleteEventInternal: _onCardDeleteButtonEvent,
      bSelected:
          bbcard_fsm.BulletinBoardCardFSMUtils.isInSelectedState(_cardFSM!),
      cardPosition: widget.cardPosition,
      initialTitle: _title,
      initialDescription: _description,
      onCardTitleChanged: _onCardTitleChanged,
      onCardDescriptionChanged: _onCardDesriptionChanged,
    );
  }

  bbcard_fsm.BulletinBoardCardFSMState _getCurrentFSMState() {
    assert(_cardFSM != null);
    return _cardFSM!.getCurrentState();
  }
}
