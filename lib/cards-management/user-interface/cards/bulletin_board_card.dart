// Copyright (C) 2023 Andrea Ballestrazzi

import 'package:astali/input-management/pointer_events.dart';

// Core and engine
import 'package:flutter/material.dart';
import 'dart:math';

typedef OnDescriptionTextChanged = void Function(String);

class BulletinBoardCardPresentation extends StatelessWidget {
  const BulletinBoardCardPresentation({
    required this.cardPosition,
    super.key
  });

  final MousePoint cardPosition;

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: <Widget>[
        Positioned(
          top: cardPosition.y,
          left: cardPosition.x,
          child: SizedBox(
            width: 200,
            height: 200,
            child: Card(
              shadowColor: Colors.black,
              color: Colors.yellow[200],
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.center,
                mainAxisAlignment: MainAxisAlignment.start,
                children: const [
                  Padding(
                    padding: EdgeInsets.symmetric(horizontal: 8, vertical: 8),
                    child: TextField(
                      decoration: InputDecoration(
                        hintText: "Title"
                      ),
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.bold,
                      ),
                      textInputAction: TextInputAction.next,
                    )
                  ),
                  Padding(padding: EdgeInsets.symmetric(horizontal: 8),
                    child: TextField(
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
                      maxLines: 5
                    )
                  )
                ]
              ),
            )
          )
        )
      ]
    );
  }
}

class BulletinBoardCard extends StatefulWidget {
  const BulletinBoardCard({
    required this.cardPosition,
    super.key
  });

  final Point<double> cardPosition;

  @override
  State<BulletinBoardCard> createState() => _BulletinBoardCardState();
}

class _BulletinBoardCardState extends State<BulletinBoardCard> {
  @override
  Widget build(BuildContext context) {
    return BulletinBoardCardPresentation(
      cardPosition: widget.cardPosition
    );
  }
}
