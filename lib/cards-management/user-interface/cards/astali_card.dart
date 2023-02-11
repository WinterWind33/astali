// Copyright (C) 2023 Andrea Ballestrazzi
import 'dart:math';

import 'package:flutter/material.dart';

class AstaliCardPresentation extends StatelessWidget {
  const AstaliCardPresentation({
    required this.cardX,
    required this.cardY,
    super.key
  });

  final double cardX;
  final double cardY;

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: <Widget>[
        Positioned(
          top: cardY,
          left: cardX,
          child: SizedBox(
            width: 200,
            height: 200,
            child: Card(
              shadowColor: Colors.black,
              color: Colors.blue,
              child: Column(
                children: const [
                  Text("Card title"),
                  Text("Card description")
                ]
              ),
            )
          )
        )
      ]
    );
  }
}

class AstaliCard extends StatefulWidget {
  const AstaliCard({
    required this.cardX,
    required this.cardY,
    super.key
  });

  final double cardX;
  final double cardY;

  @override
  State<AstaliCard> createState() => _AstaliCardState();
}

class _AstaliCardState extends State<AstaliCard> {
  @override
  Widget build(BuildContext context) {
    return AstaliCardPresentation(cardX: widget.cardX, cardY: widget.cardY);
  }
}
