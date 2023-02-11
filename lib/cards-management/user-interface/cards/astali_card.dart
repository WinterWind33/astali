// Copyright (C) 2023 Andrea Ballestrazzi

// Core and engine
import 'package:flutter/material.dart';
import 'dart:math';

typedef OnMarkdownTextChanged = void Function(String);

class AstaliCardPresentation extends StatelessWidget {
  const AstaliCardPresentation({
    required this.cardPosition,
    required this.onMarkdownTextChanged,
    required this.markdownText,
    super.key
  });

  final Point<double> cardPosition;
  final OnMarkdownTextChanged onMarkdownTextChanged;
  final String markdownText;

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

class AstaliCard extends StatefulWidget {
  const AstaliCard({
    required this.cardPosition,
    super.key
  });

  final Point<double> cardPosition;

  @override
  State<AstaliCard> createState() => _AstaliCardState();
}

class _AstaliCardState extends State<AstaliCard> {
  String _cardDescription = "";

  @override
  Widget build(BuildContext context) {
    return AstaliCardPresentation(
      cardPosition: widget.cardPosition,
      onMarkdownTextChanged: _onDescriptionChanged,
      markdownText: _cardDescription);
  }

  void _onDescriptionChanged(String value) {
    setState(() {
      _cardDescription = value;
    });
  }
}
