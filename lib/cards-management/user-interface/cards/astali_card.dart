// Copyright (C) 2023 Andrea Ballestrazzi
import 'package:flutter/material.dart';

class AstaliCardPresentation extends StatelessWidget {
  const AstaliCardPresentation({super.key});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Column(
        children: [
          const Text("Card title"),
          const Text("Card description")
        ]
      ),
    );
  }

}

class AstaliCard extends StatefulWidget {
  const AstaliCard({super.key});

  @override
  State<AstaliCard> createState() => _AstaliCardState();
}

class _AstaliCardState extends State<AstaliCard> {
  @override
  Widget build(BuildContext context) {
    return const AstaliCardPresentation();
  }
}
