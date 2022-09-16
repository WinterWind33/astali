// Copyright (C) 2022 Andrea Ballestrazzi

import 'package:flutter/material.dart';

import 'astali_injector.dart';
import 'settings/settings_items_event_handler.dart';

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
      body: createHomeBody(),
      bottomNavigationBar: createHomeBottomNavigationBar(),
    );
  }

  FloatingActionButton createAddCardButton() {
    return FloatingActionButton(
      onPressed: () {},
      tooltip: "Add a card",
      child: const Icon(Icons.add),
    );
  }

  Widget createHomeBody() {
    return Column(children: [
      Container(
        color: Colors.blue,
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [createSettingsMenuButton()],
              ),
            ),
          ],
        ),
      )
    ]);
  }

  Widget createHomeBottomNavigationBar() {
    return const BottomAppBar(
      shape: CircularNotchedRectangle(),
      color: Colors.white60,
      child: SizedBox(
        height: 50.0,
      ),
    );
  }

  Widget createSettingsMenuButton() {
    final mainInjector = widget.mainInjector;
    final eventHandler = mainInjector.getSettingsItemsEventHandler();

    return PopupMenuButton(
      icon: const Icon(Icons.settings),
      color: Colors.white,
      itemBuilder: (context) {
        return [
          PopupMenuItem(
            value: 1,
            onTap: () => eventHandler.onAboutClicked(context),
            child: const Text("About"),
          )
        ];
      },
    );
  }
}
