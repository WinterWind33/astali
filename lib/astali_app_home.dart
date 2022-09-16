// Copyright (C) 2022 Andrea Ballestrazzi
import 'package:flutter/material.dart';

import 'astali_injector.dart';

class AstaliAppHome extends StatefulWidget {
  const AstaliAppHome(AstaliInjector injector, {super.key})
      : mainInjector = injector;

  @override
  State<AstaliAppHome> createState() => _AstaliAppHomeState();

  final AstaliInjector mainInjector;
}

class _AstaliAppHomeState extends State<AstaliAppHome> {
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      floatingActionButton: createAddCardButton(),
    );
  }

  FloatingActionButton createAddCardButton() {
    return FloatingActionButton(
      onPressed: () {},
      tooltip: "Add a card",
      child: const Icon(Icons.add),
    );
  }
}
