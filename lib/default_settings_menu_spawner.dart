// Copyright (C) 2022 Andrea Ballestrazzi

import 'settings_menu_spawner.dart';
import 'package:flutter/material.dart';

abstract class DefaultSettingsMenuEventHandler {
  void onAboutSelected();
}

class DefaultSettingsMenuSpawner implements SettingsMenuSpawner {
  DefaultSettingsMenuSpawner(DefaultSettingsMenuEventHandler eventHandler)
      : settingsEventHandler = eventHandler;

  @override
  void spawnSettingsMenu(BuildContext context) {
    showMenu(context: context, position: settingsMenuPosition, items: [
      PopupMenuItem<int>(
          value: 0,
          child: const Text("About"),
          onTap: () {
            settingsEventHandler.onAboutSelected();
          })
    ]);
  }

  set menuPosition(RelativeRect position) {
    settingsMenuPosition = position;
  }

  RelativeRect settingsMenuPosition = const RelativeRect.fromLTRB(0, 0, 0, 0);

  DefaultSettingsMenuEventHandler settingsEventHandler;
}
