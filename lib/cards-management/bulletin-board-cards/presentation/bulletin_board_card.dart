// Copyright (C) 2023 Andrea Ballestrazzi

import 'package:astali/cards-management/bulletin-board-cards/bulletin_board_card_id.dart';
import 'package:astali/cards-management/bulletin-board-cards/bulletin_board_card_selection_controller.dart';
import 'package:astali/cards-management/bulletin-board-cards/bulletin_board_card_fsm.dart'
    as bbcard_fsm;
import 'package:astali/cards-management/bulletin-board-cards/bulletin_board_card_input.dart'
    as bbcard_input;
import 'package:astali/input-management/pointer_events.dart';

// Core and engine
import 'package:flutter/material.dart';
import 'dart:math';

typedef OnCardFocusChanged = void Function(bool);
typedef OnCardDeleteEventInternal = VoidCallback;
typedef OnCardDeleteEvent = void Function(BulletinBoardCardID cardID);

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
      super.key});

  final MousePoint cardPosition;
  final OnCardFocusChanged onCardFocusChanged;
  final OnPointerUpEvent onPointerUpEvent;
  final OnPointerDownEvent onPointerDownEvent;
  final OnCardDeleteEventInternal onCardDeleteEventInternal;
  final bool bSelected;

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
      required this.safeSelectionController,
      required this.onCardDeleteEvent,
      required this.cardFSM,
      required this.rawInputController,
      super.key});

  final bbcard_fsm.BulletinBoardCardFiniteStateMachine cardFSM;
  final bbcard_input.BulletinBoardCardRawInputController rawInputController;
  final Point<double> cardPosition;
  final BulletinBoardCardSafeSelectionController safeSelectionController;
  final OnCardDeleteEvent onCardDeleteEvent;

  @override
  State<BulletinBoardCard> createState() => _BulletinBoardCardState();
}

class _BulletinBoardCardState extends State<BulletinBoardCard> {
  BulletinBoardCardID? _bulletinBoardCardId;
  bbcard_fsm.BulletinBoardCardFiniteStateMachine? _cardFSM;

  BulletinBoardCardSafeSelectionController? _safeSelectionController;
  OnCardDeleteEvent? _onCardDeleteEvent;

  @override
  void initState() {
    super.initState();
    assert(widget.key != null);
    _bulletinBoardCardId = BulletinBoardCardKey.retrieveIDFromKey(widget.key!);
    _cardFSM = widget.cardFSM;
    _cardFSM!.initialize();

    _safeSelectionController = widget.safeSelectionController;
    _onCardDeleteEvent = widget.onCardDeleteEvent;
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
    _onSelectionStateChanged(true);
  }

  void _onCardFocusChanged(final bool bHasFocus) {
    _getCurrentFSMState().onCardFocusChanged(bHasFocus);
  }

  void _onCardDeleteButtonEvent() {
    _getCurrentFSMState().onCardDeletionRequested();
  }

  @override
  Widget build(BuildContext context) {
    return BulletinBoardCardPresentation(
        onCardFocusChanged: _onCardFocusChanged,
        onPointerUpEvent: _onPointerUpOnCard,
        onPointerDownEvent: _onPointerDownOnCard,
        onCardDeleteEventInternal: _onCardDeleteButtonEvent,
        bSelected:
            bbcard_fsm.BulletinBoardCardFSMUtils.isInSelectedOrEditingState(
                _cardFSM!),
        cardPosition: widget.cardPosition);
  }

  void _onSelectionStateChanged(final bool bSelected) {
    _safeSelectionController!
        .safeSetCardSelectionStateAndLock(_bulletinBoardCardId!, bSelected);
  }

  bbcard_fsm.BulletinBoardCardFSMState _getCurrentFSMState() {
    assert(_cardFSM != null);
    return _cardFSM!.getCurrentState();
  }
}
