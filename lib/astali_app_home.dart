// Copyright (C) 2022 Andrea Ballestrazzi

import 'package:flutter/material.dart';

import 'astali_injector.dart';

/// Represents the home UI widget.
///
/// It contains all of the child widget that the user can tap or interact with.
/// It builds up the main user interface.
class AstaliAppHome extends StatefulWidget {
  /// Accepts an injector used to retrieve objects used as callbacks for events.
  const AstaliAppHome(AstaliInjector injector, {super.key})
      : mainInjector = injector;

  @override
  State<AstaliAppHome> createState() => _AstaliAppHomeState();

  final AstaliInjector mainInjector;
}

/// Represents the main state of the AstaliAppHome widget.
///
/// Builds up the main user interface.
class _AstaliAppHomeState extends State<AstaliAppHome> {
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      floatingActionButton: createAddCardButton(),
      body: createHomeBody(),
      bottomNavigationBar: createHomeBottomNavigationBar(),
    );
  }

  /// Creates the floating action button with the '+' icon to add a new card
  ///
  /// NOTE: No events are attached for now.
  FloatingActionButton createAddCardButton() {
    return FloatingActionButton(
      onPressed: () {},
      tooltip: "Add a card",
      child: const Icon(Icons.add),
    );
  }

  /// Creates the body of the main user interface.
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

  /// Creates a bottom navigation bar.
  ///
  /// NOTES: Unused for now.
  Widget createHomeBottomNavigationBar() {
    return const BottomAppBar(
      shape: CircularNotchedRectangle(),
      color: Colors.white60,
      child: SizedBox(
        height: 50.0,
      ),
    );
  }

  /// Creates a button that accesses the settings menu.
  ///
  /// Builds up also the items inside the settings menu.
  Widget createSettingsMenuButton() {
    final mainInjector = widget.mainInjector;
    final eventHandler = mainInjector.getSettingsItemsEventHandler();

    return PopupMenuButton<String>(
      icon: const Icon(Icons.settings, color: Colors.white),
      color: Colors.white,
      onSelected: (value) {
        switch (value) {
          case "About":
            eventHandler.onAboutClicked(context);
            break;
        }
      },
      itemBuilder: (context) {
        return [
          const PopupMenuItem(
            value: "About",
            child: Text("About"),
          )
        ];
      },
    );
  }
}
