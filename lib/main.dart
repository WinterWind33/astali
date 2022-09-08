// Copyright (C) 2022 Andrea Ballestrazzi

import 'package:flutter/material.dart';

import 'settings/default_settings_menu_spawner.dart';
import 'settings/default_settings_menu_event_handler.dart';
import 'settings/settings_button_event_handler.dart';

void main() {
  runApp(const AstaliApp());
}

class AstaliApp extends StatelessWidget {
  const AstaliApp({super.key});

  @override
  Widget build(BuildContext context) {
    return const MaterialApp(title: 'Astali', home: AstaliAppHome());
  }
}

class AstaliAppHome extends StatefulWidget {
  const AstaliAppHome({super.key});

  @override
  State<AstaliAppHome> createState() => _AstaliAppHomeState();
}

class _AstaliAppHomeState extends State<AstaliAppHome> {
  _AstaliAppHomeState()
      : settingsMenuSpawner = DefaultSettingsMenuSpawner(
            const DefaultSettingsMenuEventHandlerImpl()) {
    settingsButtonEventHandler =
        SettingsButtonEventHandler(settingsMenuSpawner);
  }

  @override
  Widget build(BuildContext context) {
    // We want to add the main application toolbar where we can access
    // settings and the about section.
    settingsIconButtonKey = GlobalKey();

    settingsIconButton = IconButton(
        key: settingsIconButtonKey,
        icon: const Icon(Icons.settings, color: Colors.white),
        onPressed: () => onSettingsButtonPressed(context));

    Widget titleSection = Container(
        color: Colors.blue,
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Container(
                      padding: const EdgeInsets.only(right: 8),
                      child: settingsIconButton)
                ],
              ),
            ),
          ],
        ));

    return Scaffold(
        appBar: AppBar(title: const Text("Astali: an app for students")),
        body: Column(
          children: [titleSection],
        ));
  }

  void onSettingsButtonPressed(BuildContext context) {
    RenderBox box =
        settingsIconButtonKey!.currentContext!.findRenderObject() as RenderBox;
    Offset position = box.localToGlobal(Offset.zero);
    settingsMenuSpawner.menuPosition = RelativeRect.fromLTRB(
        position.dx, position.dy, position.dx, position.dy);

    settingsButtonEventHandler!.onPressed(context);
  }

  DefaultSettingsMenuSpawner settingsMenuSpawner;
  SettingsButtonEventHandler? settingsButtonEventHandler;
  IconButton? settingsIconButton;
  GlobalKey? settingsIconButtonKey;
}
