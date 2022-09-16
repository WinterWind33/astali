// Copyright (C) 2022 Andrea Ballestrazzi
import 'package:flutter/material.dart';

import 'settings_items_event_handler.dart';

class SettingsItemsEventHandlerImpl implements SettingsItemsEventHandler {
  const SettingsItemsEventHandlerImpl();

  @override
  void onAboutClicked(BuildContext context) {
    print("On About() called.");
  }
}
