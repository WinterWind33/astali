// Copyright (C) 2023 Andrea Ballestrazzi

import 'package:astali/cards-management/bulletin-board-cards/bulletin_board_card_id.dart';
import 'package:astali/cards-management/bulletin-board-cards/bulletin_board_card_selection_controller.dart';
import 'package:astali/input-management/pointer_events.dart';

// Core and engine
import 'package:flutter/material.dart';
import 'dart:math';

typedef OnDescriptionTextChanged = void Function(String);
typedef OnCardFocusChanged = void Function(bool);

typedef OnBulletinBoardCardSelected = void Function(BulletinBoardCardID, bool);

class BulletinBoardCardPresentation extends StatelessWidget {
  static const double cardWidth = 200.0;
  static const double cardHeight = 200.0;
  static const double cardTitleFontSize = 16.0;
  static const double cardDescriptionFontSize = 14.0;

  const BulletinBoardCardPresentation(
      {required this.cardPosition,
      required this.onCardFocusChanged,
      required this.onPointerUpEvent,
      required this.bSelected,
      super.key});

  final MousePoint cardPosition;
  final OnCardFocusChanged onCardFocusChanged;
  final OnPointerUpEvent onPointerUpEvent;
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
      {required this.cardID,
      required this.cardPosition,
      required this.safeSelectionController,
      super.key});

  final Point<double> cardPosition;
  final BulletinBoardCardID cardID;
  final BulletinBoardCardSafeSelectionController safeSelectionController;

  @override
  State<BulletinBoardCard> createState() => _BulletinBoardCardState();
}

class _BulletinBoardCardState extends State<BulletinBoardCard> {
  bool _bCardSelected = false;
  BulletinBoardCardID? _bulletinBoardCardId;
  BulletinBoardCardSafeSelectionController? _safeSelectionController;

  @override
  void initState() {
    super.initState();

    _bulletinBoardCardId = widget.cardID;
    _safeSelectionController = widget.safeSelectionController;
    _bCardSelected = BulletinBoardCardSelectionUtils.isCardSelected(
        _bulletinBoardCardId!, _safeSelectionController!);
  }

  void _onPointerUpOnCard(PointerUpEvent pointerUpEvent) {
    setState(() {
      _onSelectionStateChanged(true);
    });
  }

  void _onCardFocusChanged(final bool bHasFocus) {
    setState(() {
      _onSelectionStateChanged(bHasFocus);
    });
  }

  @override
  Widget build(BuildContext context) {
    return BulletinBoardCardPresentation(
        onCardFocusChanged: _onCardFocusChanged,
        onPointerUpEvent: _onPointerUpOnCard,
        bSelected: _bCardSelected,
        cardPosition: widget.cardPosition);
  }

  void _onSelectionStateChanged(final bool bSelected) {
    _bCardSelected = bSelected;
    _safeSelectionController!
        .safeSetCardSelectionStateAndLock(_bulletinBoardCardId!, bSelected);
  }
}
