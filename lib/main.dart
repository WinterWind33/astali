// Copyright (C) 2022 Andrea Ballestrazzi

import 'package:flutter/material.dart';
import 'package:astali/settings_button_event_handler.dart';

void main() {
  runApp(const AstaliApp());
}

class AstaliApp extends StatelessWidget {
  const AstaliApp({super.key});

  @override
  Widget build(BuildContext context) {
    // We want to add the main application toolbar where we can access
    // settings and the about section.
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
                      child: IconButton(
                        icon: const Icon(Icons.settings, color: Colors.white),
                        onPressed: settingsButtonEventHandler.onPressed,
                      ))
                ],
              ),
            ),
          ],
        ));

    return MaterialApp(
        title: 'Astali',
        home: Scaffold(
            appBar: AppBar(title: const Text("Astali: an app for students")),
            body: Column(
              children: [titleSection],
            )));
  }

  void onPressed() {}

  final SettingsButtonEventHandler settingsButtonEventHandler =
      const SettingsButtonEventHandler();
}
